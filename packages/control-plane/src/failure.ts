// Positron Control Plane — Failure Classification
//
// Fehler werden aus MESSBAREN Tool-Ergebnissen klassifiziert, nicht von einem
// LLM beurteilt. Provider-/Infrastrukturfehler werden NIE als Modellunfähigkeit
// gewertet (kein Test-Failure aus Provider-Timeouts).

import { isFailureClass } from './contracts.js';
import type { FailureClass } from './contracts.js';

export interface FailureSignal {
	/** Kurze, stabile Beschreibung (z. B. "test:sum.test.ts failed") */
	signature: string;
	/** Maschinenlesbarer Grund (z. B. stderr-Muster, Exit-Code) */
	evidence?: string;
}

// ---------------------------------------------------------------------------
// Klassifikation aus stderr/exit-code Mustern
// ---------------------------------------------------------------------------

const PROVIDER_PATTERNS = [
	/timeout|timed ?out/i,
	/rate ?limit/i,
	/429/i,
	/5\d\d/i,
	/api key/i,
	/authentication failed/i,
	/context length/i,
	/overloaded/i,
	/upstream/i,
	/ECONNRESET/i,
	/ENOTFOUND/i,
	/ETIMEDOUT/i,
];

const INFRA_PATTERNS = [
	/no such file/i,
	/ENOENT/i,
	/EACCES/i,
	/git (error|failed)/i,
	/workspace (not found|missing)/i,
	/cannot find/i,
	/command not found/i,
];

const LINT_PATTERNS = [/biome|lint|eslint/i];
const TYPECHECK_PATTERNS = [/typecheck|tsc|typescript/i];
const BUILD_PATTERNS = [/build failed|compilation error|tsc -b|vite build|npm run build/i];
const SECURITY_PATTERNS = [/secret|credential|security/i];

/**
 * Klassifiziert einen Fehler deterministisch.
 *
 * Priorität (erste zutreffende Klasse gewinnt):
 * 1. SECURITY_BLOCK (Sicherheitsverletzung ist niemals Test-/Build-Fehler)
 * 2. PROVIDER_FAILURE (LLM-Provider/API-Probleme)
 * 3. INFRA_FAILURE (Workspace/Git/Umgebung)
 * 4. TYPECHECK_FAILURE
 * 5. LINT_FAILURE
 * 6. BUILD_FAILURE
 * 7. TEST_FAILURE (explizit gemeldete Testfehler)
 * 8. TIMEOUT
 * 9. CONTRACT_FAILURE (Contract-Validierung)
 * 10. CONTEXT_FAILURE (fehlender Kontext/Artefakte)
 * 11. UNKNOWN
 */
export function classifyFailure(input: {
	stderr?: string;
	stdout?: string;
	exitCode?: number | null;
	explicit?: FailureClass;
	timeout?: boolean;
	contractError?: boolean;
	contextMissing?: string[];
}): FailureSignal {
	if (input.explicit && isFailureClass(input.explicit)) {
		return {
			signature: input.explicit,
			evidence: input.explicit,
		};
	}

	const combined = `${input.stderr ?? ''}\n${input.stdout ?? ''}`;

	if (input.timeout) {
		return { signature: 'TIMEOUT', evidence: 'execution exceeded configured timeout' };
	}

	if (input.contractError) {
		return { signature: 'CONTRACT_FAILURE', evidence: 'contract validation failed' };
	}

	if (input.contextMissing && input.contextMissing.length > 0) {
		return {
			signature: `CONTEXT_FAILURE:${input.contextMissing.join(',')}`,
			evidence: `missing context artifacts: ${input.contextMissing.join(', ')}`,
		};
	}

	if (SECURITY_PATTERNS.some((p) => p.test(combined))) {
		return {
			signature: 'SECURITY_BLOCK',
			evidence: 'security-sensitive pattern detected in output',
		};
	}

	if (PROVIDER_PATTERNS.some((p) => p.test(combined))) {
		return { signature: 'PROVIDER_FAILURE', evidence: 'provider/API error pattern detected' };
	}

	if (INFRA_PATTERNS.some((p) => p.test(combined))) {
		return {
			signature: 'INFRA_FAILURE',
			evidence: 'infrastructure/workspace error pattern detected',
		};
	}

	if (TYPECHECK_PATTERNS.some((p) => p.test(combined))) {
		return { signature: 'TYPECHECK_FAILURE', evidence: 'typecheck error pattern detected' };
	}

	if (LINT_PATTERNS.some((p) => p.test(combined))) {
		return { signature: 'LINT_FAILURE', evidence: 'lint error pattern detected' };
	}

	if (BUILD_PATTERNS.some((p) => p.test(combined))) {
		return { signature: 'BUILD_FAILURE', evidence: 'build error pattern detected' };
	}

	if (input.exitCode !== null && input.exitCode !== undefined && input.exitCode !== 0) {
		return {
			signature: 'TEST_FAILURE',
			evidence: `exit code ${input.exitCode}`,
		};
	}

	return { signature: 'UNKNOWN', evidence: 'no known failure pattern matched' };
}

/**
 * Erzeugt eine stabile Failure-Signatur aus Verification-Checks.
 * Gleichartige Fehler ergeben gleiche Signaturen (für Delta-Erkennung).
 */
export function failureSignatureFromChecks(
	failedChecks: Array<{ name: string; kind: string }>,
	extra: string[] = [],
): string {
	const parts = [...failedChecks.map((c) => `${c.kind}:${c.name}`), ...extra].sort();
	return parts.join('|');
}
