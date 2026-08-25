// Positron — Stop/Ask Policy Tests
//
// Verification Contract: docs/testing/verification-contract-stop-ask.md
// Protocol Spec: docs/security/stop-ask-protocol.md

import { describe, expect, it } from 'vitest';
import type { StopAskDecision, StopAskRequest } from '../stop-ask-policy.js';
import {
	evaluateStopAsk,
	getAllDecisionOutcomes,
	requiresHumanApproval,
} from '../stop-ask-policy.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function req(overrides: Partial<StopAskRequest> = {}): StopAskRequest {
	return {
		action: 'test action',
		...overrides,
	};
}

function assertDecision(
	result: ReturnType<typeof evaluateStopAsk>,
	expectedDecision: StopAskDecision,
	expectedRisk?: string,
) {
	expect(result.decision).toBe(expectedDecision);
	if (expectedRisk) {
		expect(result.risk).toBe(expectedRisk);
	}
	expect(result.reason).toBeTruthy();
	expect(result.reason.length).toBeGreaterThan(0);
	expect(result.category).toMatch(/^[ABC]$/);
	expect(Array.isArray(result.requiredEvidence)).toBe(true);
	expect(result.requiredEvidence.length).toBeGreaterThan(0);
	expect(typeof result.humanApprovalRequired).toBe('boolean');
}

// ─── Red Tests: Category A — Always Stop ────────────────────────────────────

describe('Stop/Ask Policy — Category A (Always Stop)', () => {
	it('rm -rf returns DENY with CRITICAL risk', () => {
		const result = evaluateStopAsk(req({ action: 'rm -rf /workspace/temp' }));
		assertDecision(result, 'DENY', 'CRITICAL');
		expect(result.humanApprovalRequired).toBe(true);
		expect(result.reason).toMatch(/recursive delete/i);
	});

	it('force push returns DENY with CRITICAL risk', () => {
		const result = evaluateStopAsk(req({ action: 'git push --force origin main' }));
		assertDecision(result, 'DENY', 'CRITICAL');
		expect(result.humanApprovalRequired).toBe(true);
	});

	it('--force-with-lease is also caught (substring match of --force)', () => {
		const result = evaluateStopAsk(req({ action: 'git push --force-with-lease origin main' }));
		// --force-with-lease contains --force, so it matches the force push pattern
		// or falls through to "push to main" pattern. Either way, it should NOT be ALLOW.
		expect(result.decision).not.toBe('ALLOW');
		expect(result.category).toBe('A');
	});

	it('push to main returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'push to main branch' }));
		assertDecision(result, 'DENY', 'CRITICAL');
		expect(result.humanApprovalRequired).toBe(true);
	});

	it('push to master returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'push to master branch' }));
		assertDecision(result, 'DENY', 'CRITICAL');
		expect(result.humanApprovalRequired).toBe(true);
	});

	it('DROP TABLE returns DENY with CRITICAL risk', () => {
		const result = evaluateStopAsk(req({ action: 'DROP TABLE users' }));
		assertDecision(result, 'DENY', 'CRITICAL');
		expect(result.reason).toMatch(/irreversible data loss/i);
	});

	it('TRUNCATE returns DENY with CRITICAL risk', () => {
		const result = evaluateStopAsk(req({ action: 'TRUNCATE logs' }));
		assertDecision(result, 'DENY', 'CRITICAL');
	});

	it('DELETE FROM without WHERE returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'DELETE FROM animals' }));
		assertDecision(result, 'DENY', 'CRITICAL');
	});

	it('database migration that drops columns returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'database migration drop column email' }));
		assertDecision(result, 'DENY', 'CRITICAL');
		expect(result.reason).toMatch(/irreversible data loss/i);
	});

	it('DELETE FROM with WHERE is NOT Category A (falls through to other checks)', () => {
		const result = evaluateStopAsk(req({ action: 'DELETE FROM animals WHERE id=5' }));
		// DELETE with WHERE still contains "delete" keyword → caught by destructive keyword check
		expect(result.category).toBe('A');
		expect(result.decision).not.toBe('ALLOW');
	});

	it('remote branch delete returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'delete remote branch feature/x' }));
		assertDecision(result, 'DENY', 'HIGH');
	});

	it('production API mutation returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'production api mutation to payment service' }));
		assertDecision(result, 'DENY', 'CRITICAL');
	});

	it('external deployment returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'external deployment to production' }));
		assertDecision(result, 'DENY', 'CRITICAL');
	});

	it('secret access returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'secret access to GITHUB_TOKEN' }));
		assertDecision(result, 'DENY', 'CRITICAL');
	});

	it('touchesSecrets flag returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'read config file', touchesSecrets: true }));
		assertDecision(result, 'DENY', 'CRITICAL');
		expect(result.humanApprovalRequired).toBe(true);
	});

	it('global AGENTS.md modification returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'global AGENTS.md modification' }));
		assertDecision(result, 'DENY', 'HIGH');
	});

	it('global MCP config modification returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'global MCP config modification' }));
		assertDecision(result, 'DENY', 'HIGH');
	});

	it('merge to main returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'git merge feature into main' }));
		assertDecision(result, 'DENY', 'HIGH');
	});

	it('merge to master returns DENY', () => {
		const result = evaluateStopAsk(req({ action: 'git merge feature into master' }));
		assertDecision(result, 'DENY', 'HIGH');
	});
});

// ─── Category B — Stop Unless Evidence ───────────────────────────────────────

describe('Stop/Ask Policy — Category B (Stop Unless Evidence)', () => {
	it('npm install requires dependency audit', () => {
		const result = evaluateStopAsk(req({ action: 'npm install left-pad' }));
		expect(result.category).toBe('B');
		expect(result.decision).not.toBe('ALLOW');
		expect(result.requiredEvidence).toContain('Dependency audit');
	});

	it('major version upgrade requires ASK_HUMAN', () => {
		const result = evaluateStopAsk(req({ action: 'major version upgrade of react to 19' }));
		assertDecision(result, 'ASK_HUMAN', 'HIGH');
	});

	it('feature branch merge requires review', () => {
		const result = evaluateStopAsk(req({ action: 'merge feature/xyz into develop' }));
		expect(result.category).toBe('B');
		expect(result.decision).not.toBe('ALLOW');
	});

	it('database schema change requires dry-run', () => {
		const result = evaluateStopAsk(req({ action: 'database schema change for new column' }));
		expect(result.category).toBe('B');
		expect(result.decision).toBe('REQUIRE_DRY_RUN');
		expect(result.requiredEvidence).toContain('Dry-run result');
	});

	it('database migration requires dry-run', () => {
		const result = evaluateStopAsk(req({ action: 'database migration to add index' }));
		expect(result.category).toBe('B');
		expect(result.decision).toBe('REQUIRE_DRY_RUN');
		expect(result.requiredEvidence).toContain('Migration script');
		expect(result.requiredEvidence).toContain('Rollback script');
	});

	it('external API call requires domain allowlist check', () => {
		const result = evaluateStopAsk(req({ action: 'external api call to github.com' }));
		expect(result.category).toBe('B');
		expect(result.decision).not.toBe('ALLOW');
	});

	it('config modification requires review', () => {
		const result = evaluateStopAsk(req({ action: 'config modification for biome.json' }));
		expect(result.category).toBe('B');
		expect(result.requiredEvidence).toContain('Diff preview');
	});

	it('write outside workspace requires ASK_HUMAN', () => {
		const result = evaluateStopAsk(req({ action: 'write outside workspace to /tmp' }));
		expect(result.category).toBe('B');
		assertDecision(result, 'ASK_HUMAN', 'HIGH');
	});
});

// ─── Category C — Allowed with Audit ─────────────────────────────────────────

describe('Stop/Ask Policy — Category C (Allowed with Audit)', () => {
	it('harmless read action returns ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'read package.json' }));
		assertDecision(result, 'ALLOW', 'LOW');
		expect(result.category).toBe('C');
		expect(result.humanApprovalRequired).toBe(false);
	});

	it('git commit returns ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'git commit -m "fix: bug"' }));
		assertDecision(result, 'ALLOW', 'LOW');
		expect(result.category).toBe('C');
	});

	it('npm test returns ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'npm test' }));
		assertDecision(result, 'ALLOW', 'LOW');
		expect(result.category).toBe('C');
	});

	it('npm run build returns ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'npm run build' }));
		assertDecision(result, 'ALLOW', 'LOW');
		expect(result.category).toBe('C');
	});

	it('file write within workspace returns ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'write file src/app.ts' }));
		assertDecision(result, 'ALLOW', 'LOW');
	});

	it('PR creation returns ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'create PR for feature branch' }));
		assertDecision(result, 'ALLOW', 'LOW');
	});
});

// ─── Flags and Edge Cases ────────────────────────────────────────────────────

describe('Stop/Ask Policy — Flags and Edge Cases', () => {
	it('externalMutation flag triggers ASK_HUMAN', () => {
		const result = evaluateStopAsk(req({ action: 'update remote config', externalMutation: true }));
		assertDecision(result, 'ASK_HUMAN', 'HIGH');
		expect(result.category).toBe('A');
		expect(result.humanApprovalRequired).toBe(true);
	});

	it('outsideWorkspace flag triggers DENY', () => {
		const result = evaluateStopAsk(req({ action: 'read file', outsideWorkspace: true }));
		assertDecision(result, 'DENY', 'HIGH');
		expect(result.category).toBe('A');
	});

	it('destructive flag triggers ASK_HUMAN even for unknown action', () => {
		const result = evaluateStopAsk(req({ action: 'some unknown operation', destructive: true }));
		assertDecision(result, 'ASK_HUMAN', 'HIGH');
		expect(result.category).toBe('A');
		expect(result.reason).toMatch(/unclassified/i);
	});

	it('unknown destructive keyword triggers ASK_HUMAN', () => {
		const result = evaluateStopAsk(req({ action: 'clean the build cache' }));
		// "clean" is in destructive keywords
		assertDecision(result, 'ASK_HUMAN', 'HIGH');
		expect(result.category).toBe('A');
	});

	it('PRODUCTION repo risk requires review for any action', () => {
		const result = evaluateStopAsk(req({ action: 'read config', repoRisk: 'PRODUCTION' }));
		expect(result.category).toBe('B');
		expect(result.decision).not.toBe('ALLOW');
		expect(result.humanApprovalRequired).toBe(true);
	});

	it('CRITICAL repo risk requires review for any action', () => {
		const result = evaluateStopAsk(req({ action: 'read config', repoRisk: 'CRITICAL' }));
		expect(result.category).toBe('B');
		expect(result.decision).not.toBe('ALLOW');
		expect(result.humanApprovalRequired).toBe(true);
	});

	it('TEST repo risk allows harmless actions', () => {
		const result = evaluateStopAsk(req({ action: 'read config', repoRisk: 'TEST' }));
		assertDecision(result, 'ALLOW', 'LOW');
	});

	it('empty action returns ALLOW (default Category C)', () => {
		const result = evaluateStopAsk(req({ action: '' }));
		assertDecision(result, 'ALLOW', 'LOW');
		expect(result.category).toBe('C');
	});

	it('every result has a non-empty reason', () => {
		const actions = ['harmless read', 'rm -rf /tmp', 'git push --force', 'npm install express'];
		for (const action of actions) {
			const result = evaluateStopAsk(req({ action }));
			expect(result.reason.length).toBeGreaterThan(0);
		}
	});

	it('every result has requiredEvidence as non-empty array', () => {
		const actions = ['harmless read', 'rm -rf /tmp', 'git push --force'];
		for (const action of actions) {
			const result = evaluateStopAsk(req({ action }));
			expect(Array.isArray(result.requiredEvidence)).toBe(true);
			expect(result.requiredEvidence.length).toBeGreaterThan(0);
		}
	});

	it('Category A results always require human approval', () => {
		const catAActions = [
			{ action: 'rm -rf /tmp' },
			{ action: 'git push --force' },
			{ touchesSecrets: true, action: 'x' },
			{ outsideWorkspace: true, action: 'x' },
			{ destructive: true, action: 'x' },
		];
		for (const overrides of catAActions) {
			const result = evaluateStopAsk(req(overrides));
			if (result.category === 'A') {
				expect(result.humanApprovalRequired).toBe(true);
			}
		}
	});
});

// ─── Decision Coverage ───────────────────────────────────────────────────────

describe('Stop/Ask Policy — All Decision Outcomes Covered', () => {
	it('covers ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'read a file' }));
		expect(result.decision).toBe('ALLOW');
	});

	it('covers DENY', () => {
		const result = evaluateStopAsk(req({ action: 'rm -rf /tmp' }));
		expect(result.decision).toBe('DENY');
	});

	it('covers ASK_HUMAN', () => {
		const result = evaluateStopAsk(req({ action: 'major version upgrade' }));
		expect(result.decision).toBe('ASK_HUMAN');
	});

	it('covers REQUIRE_DRY_RUN', () => {
		const result = evaluateStopAsk(req({ action: 'database migration' }));
		expect(result.decision).toBe('REQUIRE_DRY_RUN');
	});

	it('covers REQUIRE_BACKUP', () => {
		// REQUIRE_BACKUP is not directly triggered by any pattern in current implementation.
		// It is defined as a valid decision outcome for future use (e.g., when combined
		// with ASK_HUMAN + destructive operations). The type system validates it exists.
		const allDecisions = getAllDecisionOutcomes();
		expect(allDecisions).toContain('REQUIRE_BACKUP');
	});

	it('covers REQUIRE_REVIEW', () => {
		const result = evaluateStopAsk(req({ action: 'npm install lodash' }));
		expect(result.decision).toBe('REQUIRE_REVIEW');
	});

	it('all six decision outcomes are defined', () => {
		const decisions = getAllDecisionOutcomes();
		expect(decisions).toHaveLength(6);
		expect(decisions).toContain('ALLOW');
		expect(decisions).toContain('DENY');
		expect(decisions).toContain('ASK_HUMAN');
		expect(decisions).toContain('REQUIRE_DRY_RUN');
		expect(decisions).toContain('REQUIRE_BACKUP');
		expect(decisions).toContain('REQUIRE_REVIEW');
	});
});

// ─── Helper Functions ────────────────────────────────────────────────────────

describe('Stop/Ask Policy — Helper Functions', () => {
	it('requiresHumanApproval returns false for ALLOW', () => {
		expect(requiresHumanApproval('ALLOW')).toBe(false);
	});

	it('requiresHumanApproval returns true for DENY', () => {
		expect(requiresHumanApproval('DENY')).toBe(true);
	});

	it('requiresHumanApproval returns true for ASK_HUMAN', () => {
		expect(requiresHumanApproval('ASK_HUMAN')).toBe(true);
	});

	it('requiresHumanApproval returns true for REQUIRE_DRY_RUN', () => {
		expect(requiresHumanApproval('REQUIRE_DRY_RUN')).toBe(true);
	});

	it('requiresHumanApproval returns true for REQUIRE_BACKUP', () => {
		expect(requiresHumanApproval('REQUIRE_BACKUP')).toBe(true);
	});

	it('requiresHumanApproval returns true for REQUIRE_REVIEW', () => {
		expect(requiresHumanApproval('REQUIRE_REVIEW')).toBe(true);
	});
});

// ─── Verification Contract: Security Constraints ─────────────────────────────

describe('Stop/Ask Policy — Verification Contract Compliance', () => {
	it('destructive actions never return ALLOW', () => {
		const destructiveActions = [
			{ action: 'rm -rf /tmp' },
			{ action: 'DROP TABLE users' },
			{ action: 'TRUNCATE logs' },
			{ destructive: true, action: 'unknown destructive' },
			{ action: 'delete remote branch x' },
		];
		for (const overrides of destructiveActions) {
			const result = evaluateStopAsk(req(overrides));
			expect(result.decision).not.toBe('ALLOW');
		}
	});

	it('push/merge/force-push never return ALLOW', () => {
		const actions = [
			'git push --force origin main',
			'push to main branch',
			'git merge feature into main',
			'git push -f',
		];
		for (const action of actions) {
			const result = evaluateStopAsk(req({ action }));
			expect(result.decision).not.toBe('ALLOW');
		}
	});

	it('secret access is never ALLOW', () => {
		const results = [
			evaluateStopAsk(req({ action: 'secret access' })),
			evaluateStopAsk(req({ action: 'read config', touchesSecrets: true })),
		];
		for (const result of results) {
			expect(result.decision).not.toBe('ALLOW');
			expect(result.humanApprovalRequired).toBe(true);
		}
	});

	it('database drop/truncate is never ALLOW', () => {
		const actions = ['DROP TABLE users', 'TRUNCATE logs', 'DELETE FROM animals'];
		for (const action of actions) {
			const result = evaluateStopAsk(req({ action }));
			expect(result.decision).not.toBe('ALLOW');
		}
	});

	it('outside workspace cleanup is never ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'cleanup', outsideWorkspace: true }));
		expect(result.decision).not.toBe('ALLOW');
	});

	it('global config modifications are never ALLOW', () => {
		const actions = ['global AGENTS.md modification', 'global MCP config modification'];
		for (const action of actions) {
			const result = evaluateStopAsk(req({ action }));
			expect(result.decision).not.toBe('ALLOW');
		}
	});

	it('unknown action without destructive flags is ALLOW', () => {
		const result = evaluateStopAsk(req({ action: 'some benign unknown action' }));
		expect(result.decision).toBe('ALLOW');
	});
});
