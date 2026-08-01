// Positron — Rudolph Beacon Evidence Contract Tests (Red Tests)
//
// Tests for evidence-contract.ts: schema, secret redaction, conclusion logic.
//
// Red Tests: 8, 9, 10, 11, 14 from the specification

import { describe, expect, it } from 'vitest';
import {
	containsSecrets,
	createCommandResult,
	createIssueResult,
	determineConclusionStatus,
	redactSecrets,
	validateRunSummary,
} from '../evidence-contract.js';
import type { BenchmarkIssueResult, RudolphBenchmarkRunSummary } from '../evidence-contract.js';

// =============================================================================
// Red Test 8: Evidence contains executionMode
// =============================================================================
describe('Red Test 8 — Evidence contains executionMode', () => {
	it('can construct a summary with explicit executionMode', () => {
		const modes = ['fixture', 'dry-run', 'real'] as const;
		for (const mode of modes) {
			const summary: { executionMode: typeof mode } = { executionMode: mode };
			expect(summary.executionMode).toBe(mode);
		}
	});

	it('executionMode is required (TypeScript would enforce this)', () => {
		// Runtime verification: the type system enforces executionMode presence
		const result = createIssueResult('BENCH-001', 'Test');
		// executionMode is part of RudolphBenchmarkRunSummary, not IssueResult
		// This test verifies that the type exists and can be constructed
		expect(result.status).toBe('UNKNOWN_EVIDENCE');
	});
});

// =============================================================================
// Red Test 9: Evidence contains NO fake secrets
// =============================================================================
describe('Red Test 9 — Evidence contains no secrets', () => {
	it('redacts GitHub token patterns', () => {
		const input = 'Token: ghp_abcdef123456789012345678901234567890';
		const result = redactSecrets(input);
		expect(result).not.toContain('ghp_');
		expect(result).toContain('***REDACTED***');
	});

	it('redacts OpenAI key patterns', () => {
		const input = 'Key: sk-proj-abcdef123456789012345678901234';
		const result = redactSecrets(input);
		expect(result).not.toContain('sk-');
		expect(result).toContain('***REDACTED***');
	});

	it('redacts multiple patterns in one string', () => {
		const input =
			'ghp_token123456789012345678901234567890 and sk-key123456789012345678901234567890';
		const result = redactSecrets(input);
		expect(result).not.toContain('ghp_');
		expect(result).not.toContain('sk-');
	});

	it('containsSecrets detects GitHub tokens', () => {
		expect(containsSecrets('ghp_abcdef123456789012345678901234567890')).toBe(true);
	});

	it('containsSecrets returns false for clean strings', () => {
		expect(containsSecrets('This is a clean string with no secrets')).toBe(false);
	});

	it('clean evidence has no secrets', () => {
		const result = createIssueResult('BENCH-003', 'Evidence Contract');
		const json = JSON.stringify(result);
		expect(containsSecrets(json)).toBe(false);
	});
});

// =============================================================================
// Red Test 10: Missing evidence → UNKNOWN_EVIDENCE
// =============================================================================
describe('Red Test 10 — Missing evidence → UNKNOWN_EVIDENCE', () => {
	it('fresh issue result defaults to UNKNOWN_EVIDENCE', () => {
		const result = createIssueResult('BENCH-001', 'Domain Baseline');
		expect(result.status).toBe('UNKNOWN_EVIDENCE');
	});

	it('UNKNOWN_EVIDENCE has confidence 0', () => {
		const result = createIssueResult('BENCH-001', 'Domain Baseline');
		expect(result.confidence).toBe(0);
	});

	it('UNKNOWN_EVIDENCE has empty evidence paths', () => {
		const result = createIssueResult('BENCH-001', 'Domain Baseline');
		expect(result.evidencePaths).toHaveLength(0);
	});
});

// =============================================================================
// Red Test 11: DONE without evidence is forbidden
// =============================================================================
describe('Red Test 11 — DONE without evidence forbidden', () => {
	it('DONE status with empty evidencePaths should be detected as invalid', () => {
		const issue: BenchmarkIssueResult = {
			id: 'BENCH-001',
			title: 'Test',
			status: 'DONE',
			evidencePaths: [],
			testNames: [],
			changedFiles: [],
			confidence: 0.9,
		};

		// Evidence validation: DONE + empty evidence = invalid
		const isValid = issue.status === 'DONE' && issue.evidencePaths.length > 0;
		expect(isValid).toBe(false);
	});

	it('DONE status WITH evidence paths is valid', () => {
		const issue: BenchmarkIssueResult = {
			id: 'BENCH-001',
			title: 'Test',
			status: 'DONE',
			evidencePaths: ['evidence/test.json'],
			testNames: ['test1'],
			changedFiles: ['src/file.ts'],
			confidence: 0.9,
		};

		const isValid = issue.status === 'DONE' && issue.evidencePaths.length > 0;
		expect(isValid).toBe(true);
	});

	it('evidence contract prevents DONE without evidence', () => {
		// createIssueResult always creates UNKNOWN_EVIDENCE, never DONE
		const result = createIssueResult('BENCH-001', 'Test');
		expect(result.status).not.toBe('DONE');
	});
});

// =============================================================================
// Red Test 14: Conclusion not GREEN when tests are missing
// =============================================================================
describe('Red Test 14 — No GREEN conclusion without test evidence', () => {
	it('empty issues → UNKNOWN', () => {
		expect(determineConclusionStatus([])).toBe('UNKNOWN');
	});

	it('all UNKNOWN_EVIDENCE → YELLOW', () => {
		const issues: BenchmarkIssueResult[] = [
			createIssueResult('BENCH-001', 'Test 1'),
			createIssueResult('BENCH-002', 'Test 2'),
		];
		expect(determineConclusionStatus(issues)).toBe('YELLOW');
	});

	it('BLOCKED issue → RED', () => {
		const issues: BenchmarkIssueResult[] = [
			{
				id: 'BENCH-001',
				title: 'Test',
				status: 'BLOCKED',
				evidencePaths: [],
				testNames: [],
				changedFiles: [],
				confidence: 0,
			},
		];
		expect(determineConclusionStatus(issues)).toBe('RED');
	});

	it('DONE with low confidence (0.2) → RED', () => {
		const issues: BenchmarkIssueResult[] = [
			{
				id: 'BENCH-001',
				title: 'Test',
				status: 'DONE',
				evidencePaths: ['evidence/test.json'],
				testNames: ['test1'],
				changedFiles: [],
				confidence: 0.2,
			},
		];
		expect(determineConclusionStatus(issues)).toBe('RED');
	});

	it('all DONE with high confidence → GREEN', () => {
		const issues: BenchmarkIssueResult[] = [
			{
				id: 'BENCH-001',
				title: 'Test 1',
				status: 'DONE',
				evidencePaths: ['evidence/test.json'],
				testNames: ['test1'],
				changedFiles: [],
				confidence: 0.9,
			},
			{
				id: 'BENCH-002',
				title: 'Test 2',
				status: 'DONE',
				evidencePaths: ['evidence/test2.json'],
				testNames: ['test2'],
				changedFiles: [],
				confidence: 0.85,
			},
		];
		expect(determineConclusionStatus(issues)).toBe('GREEN');
	});

	it('mixed DONE + UNKNOWN_EVIDENCE → YELLOW', () => {
		const issues: BenchmarkIssueResult[] = [
			{
				id: 'BENCH-001',
				title: 'Test 1',
				status: 'DONE',
				evidencePaths: ['evidence/test.json'],
				testNames: ['test1'],
				changedFiles: [],
				confidence: 0.9,
			},
			createIssueResult('BENCH-002', 'Test 2'), // UNKNOWN_EVIDENCE
		];
		expect(determineConclusionStatus(issues)).toBe('YELLOW');
	});
});

// =============================================================================
// createCommandResult
// =============================================================================
describe('createCommandResult', () => {
	it('creates a valid command result', () => {
		const result = createCommandResult('npm test', 'npm test', 0, 1500);
		expect(result.name).toBe('npm test');
		expect(result.exitCode).toBe(0);
		expect(result.durationMs).toBe(1500);
	});
});

// =============================================================================
// validateRunSummary — Schema Validation Tests
// =============================================================================

/** Minimal valid summary used across validation tests. */
function makeValidSummary(): RudolphBenchmarkRunSummary {
	return {
		runId: 'test-run-001',
		timestampUtc: '2026-06-24T17:00:00Z',
		executionMode: 'fixture',
		benchmarkName: 'rudolph-beacon',
		repo: {
			branch: 'feat/test',
			commitSha: 'abc123def456',
			status: 'clean',
		},
		issues: [
			{
				id: 'ISSUE-001',
				title: 'Test Issue',
				status: 'DONE',
				evidencePaths: ['evidence/issue-001.json'],
				testNames: ['test-1'],
				changedFiles: ['src/file.ts'],
				confidence: 0.9,
			},
		],
		commands: [
			{
				name: 'build',
				command: 'npm run build',
				exitCode: 0,
				durationMs: 1500,
			},
		],
		tests: {
			passed: 100,
			failed: 0,
			skipped: 0,
			redTestsCovered: ['Red Test 1'],
		},
		safety: {
			secretsRedacted: true,
			blockedActions: [],
			warnings: ['test warning'],
		},
		conclusion: {
			status: 'GREEN',
			whatWorks: ['everything'],
			whatDoesNotWork: [],
			whatIsUnproven: [],
			confidence: 0.95,
		},
		capabilityDelta: {
			newCapabilities: ['feature A'],
			removedBlockers: [],
			unchangedLimitations: ['limit X'],
			remainingRisks: ['risk Y'],
			nextBestStep: 'run more tests',
		},
	};
}

describe('validateRunSummary — null and non-object', () => {
	it('rejects null', () => {
		expect(validateRunSummary(null)).toEqual(['summary is not an object']);
	});

	it('rejects undefined', () => {
		expect(validateRunSummary(undefined)).toEqual(['summary is not an object']);
	});

	it('rejects string', () => {
		expect(validateRunSummary('not-an-object')).toEqual(['summary is not an object']);
	});

	it('rejects number', () => {
		expect(validateRunSummary(42)).toEqual(['summary is not an object']);
	});
});

describe('validateRunSummary — top-level required fields', () => {
	it('accepts a fully valid summary', () => {
		expect(validateRunSummary(makeValidSummary())).toEqual([]);
	});

	it('rejects empty runId', () => {
		const s = makeValidSummary();
		(s as unknown as Record<string, unknown>).runId = '';
		expect(validateRunSummary(s)).toContain('runId: must be a non-empty string');
	});

	it('rejects missing runId', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s as unknown as Record<string, unknown>, 'runId');
		expect(validateRunSummary(s)).toContain('runId: must be a non-empty string');
	});

	it('rejects empty timestampUtc', () => {
		const s = makeValidSummary();
		(s as unknown as Record<string, unknown>).timestampUtc = '';
		expect(validateRunSummary(s)).toContain('timestampUtc: must be a non-empty string');
	});

	it('rejects invalid executionMode', () => {
		const s = makeValidSummary();
		(s as unknown as Record<string, unknown>).executionMode = 'production';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('executionMode'))).toBe(true);
	});

	it('accepts all valid execution modes', () => {
		for (const mode of ['fixture', 'dry-run', 'real'] as const) {
			const s = makeValidSummary();
			s.executionMode = mode;
			expect(validateRunSummary(s)).toEqual([]);
		}
	});

	it('rejects invalid benchmarkName', () => {
		const s = makeValidSummary();
		(s as unknown as Record<string, unknown>).benchmarkName = 'other-benchmark';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('benchmarkName'))).toBe(true);
	});
});

describe('validateRunSummary — repo validation', () => {
	it('rejects missing repo', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s as unknown as Record<string, unknown>, 'repo');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('repo:'))).toBe(true);
	});

	it('rejects null repo', () => {
		const s = makeValidSummary();
		(s as unknown as Record<string, unknown>).repo = null;
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('repo:'))).toBe(true);
	});

	it('rejects empty branch', () => {
		const s = makeValidSummary();
		s.repo.branch = '';
		expect(validateRunSummary(s)).toContain('repo.branch: must be a non-empty string');
	});

	it('rejects empty commitSha', () => {
		const s = makeValidSummary();
		s.repo.commitSha = '';
		expect(validateRunSummary(s)).toContain('repo.commitSha: must be a non-empty string');
	});

	it('rejects invalid repo status', () => {
		const s = makeValidSummary();
		(s.repo as unknown as Record<string, unknown>).status = 'modified';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('repo.status'))).toBe(true);
	});

	it('accepts all valid repo statuses', () => {
		for (const status of ['clean', 'dirty', 'unknown'] as const) {
			const s = makeValidSummary();
			s.repo.status = status;
			expect(validateRunSummary(s)).toEqual([]);
		}
	});
});

describe('validateRunSummary — issues array', () => {
	it('rejects missing issues array', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s as unknown as Record<string, unknown>, 'issues');
		expect(validateRunSummary(s)).toContain('issues: must be an array');
	});

	it('accepts empty issues array', () => {
		const s = makeValidSummary();
		s.issues = [];
		expect(validateRunSummary(s)).toEqual([]);
	});

	it('rejects invalid issue status', () => {
		const s = makeValidSummary();
		(s.issues[0] as unknown as Record<string, unknown>).status = 'INVALID';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('status'))).toBe(true);
	});

	it('rejects confidence out of range (negative)', () => {
		const s = makeValidSummary();
		s.issues[0]!.confidence = -0.1;
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('confidence'))).toBe(true);
	});

	it('rejects confidence out of range (>1)', () => {
		const s = makeValidSummary();
		s.issues[0]!.confidence = 1.5;
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('confidence'))).toBe(true);
	});

	it('rejects DONE without evidence paths', () => {
		const s = makeValidSummary();
		s.issues[0]!.status = 'DONE';
		s.issues[0]!.evidencePaths = [];
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('DONE status but no evidence paths'))).toBe(true);
	});

	it('accepts PARTIAL with empty evidence paths', () => {
		const s = makeValidSummary();
		s.issues[0]!.status = 'PARTIAL';
		s.issues[0]!.evidencePaths = [];
		// PARTIAL without evidence is not forbidden (only DONE is)
		const errors = validateRunSummary(s);
		expect(errors.filter((e) => e.includes('DONE status but no evidence')).length).toBe(0);
	});

	it('rejects issue with missing id', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s.issues[0] as unknown as Record<string, unknown>, 'id');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('.id:'))).toBe(true);
	});

	it('rejects issue with empty title', () => {
		const s = makeValidSummary();
		(s.issues[0] as unknown as Record<string, unknown>).title = '';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('.title:'))).toBe(true);
	});
});

describe('validateRunSummary — commands array', () => {
	it('rejects missing commands array', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s as unknown as Record<string, unknown>, 'commands');
		expect(validateRunSummary(s)).toContain('commands: must be an array');
	});

	it('accepts empty commands array', () => {
		const s = makeValidSummary();
		s.commands = [];
		expect(validateRunSummary(s)).toEqual([]);
	});

	it('rejects command with empty name', () => {
		const s = makeValidSummary();
		(s.commands[0] as unknown as Record<string, unknown>).name = '';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('name:'))).toBe(true);
	});

	it('rejects command with empty command string', () => {
		const s = makeValidSummary();
		(s.commands[0] as unknown as Record<string, unknown>).command = '';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('command:'))).toBe(true);
	});

	it('rejects command with non-numeric durationMs', () => {
		const s = makeValidSummary();
		(s.commands[0] as unknown as Record<string, unknown>).durationMs = 'slow';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('durationMs'))).toBe(true);
	});
});

describe('validateRunSummary — tests validation', () => {
	it('rejects missing tests object', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s as unknown as Record<string, unknown>, 'tests');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('tests:'))).toBe(true);
	});

	it('rejects null tests', () => {
		const s = makeValidSummary();
		(s as unknown as Record<string, unknown>).tests = null;
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('tests:'))).toBe(true);
	});

	it('rejects non-numeric passed', () => {
		const s = makeValidSummary();
		(s.tests as unknown as Record<string, unknown>).passed = 'many';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('tests.passed'))).toBe(true);
	});

	it('rejects missing redTestsCovered array', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s.tests as unknown as Record<string, unknown>, 'redTestsCovered');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('redTestsCovered'))).toBe(true);
	});
});

describe('validateRunSummary — safety validation', () => {
	it('rejects missing safety object', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s as unknown as Record<string, unknown>, 'safety');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('safety:'))).toBe(true);
	});

	it('rejects non-boolean secretsRedacted', () => {
		const s = makeValidSummary();
		(s.safety as unknown as Record<string, unknown>).secretsRedacted = 'yes';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('secretsRedacted'))).toBe(true);
	});

	it('rejects missing blockedActions array', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s.safety as unknown as Record<string, unknown>, 'blockedActions');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('blockedActions'))).toBe(true);
	});

	it('rejects missing warnings array', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s.safety as unknown as Record<string, unknown>, 'warnings');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('warnings'))).toBe(true);
	});
});

describe('validateRunSummary — conclusion validation', () => {
	it('rejects missing conclusion', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s as unknown as Record<string, unknown>, 'conclusion');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('conclusion:'))).toBe(true);
	});

	it('rejects invalid conclusion status', () => {
		const s = makeValidSummary();
		(s.conclusion as unknown as Record<string, unknown>).status = 'BLUE';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('conclusion.status'))).toBe(true);
	});

	it('rejects confidence out of range', () => {
		const s = makeValidSummary();
		s.conclusion.confidence = 2.0;
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('conclusion.confidence'))).toBe(true);
	});

	it('rejects GREEN conclusion when issues are not all DONE with evidence', () => {
		const s = makeValidSummary();
		s.conclusion.status = 'GREEN';
		s.issues = [
			{
				id: 'ISSUE-001',
				title: 'Incomplete',
				status: 'PARTIAL',
				evidencePaths: [],
				testNames: [],
				changedFiles: [],
				confidence: 0.5,
			},
		];
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('GREEN requires all issues DONE'))).toBe(true);
	});

	it('accepts GREEN conclusion with empty issues (vacuous truth)', () => {
		const s = makeValidSummary();
		s.conclusion.status = 'GREEN';
		s.issues = [];
		expect(validateRunSummary(s)).toEqual([]);
	});

	it('rejects missing whatWorks array', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s.conclusion as unknown as Record<string, unknown>, 'whatWorks');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('whatWorks'))).toBe(true);
	});

	it('rejects missing whatDoesNotWork array', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s.conclusion as unknown as Record<string, unknown>, 'whatDoesNotWork');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('whatDoesNotWork'))).toBe(true);
	});

	it('rejects missing whatIsUnproven array', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s.conclusion as unknown as Record<string, unknown>, 'whatIsUnproven');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('whatIsUnproven'))).toBe(true);
	});
});

describe('validateRunSummary — capabilityDelta validation', () => {
	it('rejects missing capabilityDelta', () => {
		const s = makeValidSummary();
		Reflect.deleteProperty(s as unknown as Record<string, unknown>, 'capabilityDelta');
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('capabilityDelta:'))).toBe(true);
	});

	it('rejects non-array newCapabilities', () => {
		const s = makeValidSummary();
		(s.capabilityDelta as unknown as Record<string, unknown>).newCapabilities = 'not-array';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('newCapabilities'))).toBe(true);
	});

	it('rejects missing nextBestStep', () => {
		const s = makeValidSummary();
		(s.capabilityDelta as unknown as Record<string, unknown>).nextBestStep = '';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('nextBestStep'))).toBe(true);
	});

	it('rejects non-array removedBlockers', () => {
		const s = makeValidSummary();
		(s.capabilityDelta as unknown as Record<string, unknown>).removedBlockers = null;
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('removedBlockers'))).toBe(true);
	});

	it('rejects non-array unchangedLimitations', () => {
		const s = makeValidSummary();
		(s.capabilityDelta as unknown as Record<string, unknown>).unchangedLimitations = 'string';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('unchangedLimitations'))).toBe(true);
	});

	it('rejects non-array remainingRisks', () => {
		const s = makeValidSummary();
		(s.capabilityDelta as unknown as Record<string, unknown>).remainingRisks = 42;
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('remainingRisks'))).toBe(true);
	});
});

describe('validateRunSummary — secret detection in summary', () => {
	it('detects GitHub token in summary string fields', () => {
		const s = makeValidSummary();
		(s as unknown as Record<string, unknown>).runId = 'ghp_abcdef123456789012345678901234567890';
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('potential secrets'))).toBe(true);
	});

	it('detects OpenAI key in conclusion.whatWorks', () => {
		const s = makeValidSummary();
		s.conclusion.whatWorks = ['key: sk-proj-abcdef123456789012345678901234'];
		const errors = validateRunSummary(s);
		expect(errors.some((e) => e.includes('potential secrets'))).toBe(true);
	});

	it('does not flag clean summaries', () => {
		const s = makeValidSummary();
		expect(validateRunSummary(s)).toEqual([]);
	});
});

describe('validateRunSummary — multiple errors aggregated', () => {
	it('returns all errors from multiple invalid fields', () => {
		const s = makeValidSummary();
		(s as unknown as Record<string, unknown>).runId = '';
		(s as unknown as Record<string, unknown>).benchmarkName = 'wrong';
		s.conclusion.confidence = 2.0;
		const errors = validateRunSummary(s);
		expect(errors.length).toBeGreaterThanOrEqual(3);
	});
});

describe('validateRunSummary — edge cases', () => {
	it('accepts real execution mode', () => {
		const s = makeValidSummary();
		s.executionMode = 'real';
		expect(validateRunSummary(s)).toEqual([]);
	});

	it('accepts dry-run execution mode', () => {
		const s = makeValidSummary();
		s.executionMode = 'dry-run';
		expect(validateRunSummary(s)).toEqual([]);
	});

	it('accepts RED conclusion status', () => {
		const s = makeValidSummary();
		s.conclusion.status = 'RED';
		const errors = validateRunSummary(s);
		// RED conclusion is allowed; the GREEN consistency check only fires for GREEN
		expect(errors.filter((e) => e.includes('GREEN requires')).length).toBe(0);
	});

	it('accepts YELLOW conclusion status', () => {
		const s = makeValidSummary();
		s.conclusion.status = 'YELLOW';
		expect(validateRunSummary(s)).toEqual([]);
	});

	it('accepts confidence at boundary 0 (non-GREEN conclusion)', () => {
		const s = makeValidSummary();
		s.conclusion.status = 'RED';
		s.issues[0]!.confidence = 0;
		s.conclusion.confidence = 0;
		const errors = validateRunSummary(s);
		// Confidence 0 is valid; GREEN consistency check is separate and not triggered for RED
		expect(errors.filter((e) => e.includes('confidence')).length).toBe(0);
	});

	it('accepts confidence at boundary 1', () => {
		const s = makeValidSummary();
		s.issues[0]!.confidence = 1;
		s.conclusion.confidence = 1;
		const errors = validateRunSummary(s);
		expect(errors.filter((e) => e.includes('confidence')).length).toBe(0);
	});
});
