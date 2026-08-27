// Positron — Commit & Push Policy

/** Erlaubtes Branch-Pattern für Positron */
export const ALLOWED_BRANCH_PATTERN = /^positron\/issue-\d+-[a-z0-9-]+$/;

/** Geschützte Branches */
export const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

/** Blockierte Push-Flags */
export const BLOCKED_PUSH_FLAGS = ['--force', '-f', '--force-with-lease'];

/** Kontext für einen Commit */
export interface CommitContext {
	issueNumber: number;
	branch: string;
	workspacePath: string;
	message?: string;
}

/** Ergebnis der Branch-Guard-Prüfung */
export interface BranchGuardResult {
	allowed: boolean;
	reason?: string;
}

/** Ergebnis der Push-Policy-Prüfung */
export interface PushPolicyResult {
	allowed: boolean;
	reason?: string;
}

/**
 * Prüft ob ein Branch-Name den Positron-Richtlinien entspricht.
 */
export function guardBranch(branch: string): BranchGuardResult {
	if (!branch) {
		return { allowed: false, reason: 'Branch name is empty' };
	}

	if (PROTECTED_BRANCHES.includes(branch)) {
		return {
			allowed: false,
			reason: `Branch "${branch}" is protected — use a positron/issue-* branch`,
		};
	}

	if (!ALLOWED_BRANCH_PATTERN.test(branch) && !branch.startsWith('positron/')) {
		return {
			allowed: false,
			reason: `Branch "${branch}" does not match pattern positron/issue-<number>-<slug>`,
		};
	}

	return { allowed: true };
}

/**
 * Validiert die Push-Policy basierend auf Umgebungsvariablen.
 */
export function evaluatePushPolicy(branch: string, flags: string[]): PushPolicyResult {
	// Branch-Guard
	const branchGuard = guardBranch(branch);
	if (!branchGuard.allowed) {
		return branchGuard;
	}

	// Blockierte Flags
	for (const flag of flags) {
		if (BLOCKED_PUSH_FLAGS.includes(flag)) {
			return { allowed: false, reason: `Flag "${flag}" is blocked by Positron policy` };
		}
	}

	// POSITRON_ENABLE_PUSH prüfen
	if (process.env['POSITRON_ENABLE_PUSH'] !== 'true') {
		return { allowed: false, reason: 'POSITRON_ENABLE_PUSH is not set to "true"' };
	}

	return { allowed: true };
}

/**
 * Generiert eine Commit-Message im Positron-Format.
 */
export function generateCommitMessage(issueNumber: number, description: string): string {
	return `feat(issue-${issueNumber}): ${description}\n\nAutomated by Positron — https://github.com/Mueller-Systems-Lab/Positron`;
}

/**
 * Prüft ob ein Branch-Name dem Positron-Format entspricht.
 */
export function isValidPositronBranch(branch: string): boolean {
	return ALLOWED_BRANCH_PATTERN.test(branch);
}
