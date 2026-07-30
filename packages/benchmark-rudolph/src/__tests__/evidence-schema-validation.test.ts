// Positron — Rudolph Beacon Evidence Schema Validation Tests
//
// Validates that run-summary JSON artifacts conform to the evidence contract.
// Checks for required fields, valid enum values, value ranges, and evidence integrity.
//
// Anschlusslauf — Coverage + Schema Hardening

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
	BenchmarkCommandResult,
	BenchmarkConclusion,
	BenchmarkIssueResult,
	CapabilityDelta,
	RudolphBenchmarkRunSummary,
} from '../evidence-contract.js';
import {
	VALID_EXECUTION_MODES,
	containsSecrets,
	determineConclusionStatus,
	validateRunSummary,
} from '../evidence-contract.js';

// =============================================================================
// Valid Summary Factory (for testing)
// =============================================================================

function createValidSummary(): RudolphBenchmarkRunSummary {
	return {
		runId: 'test-schema-run-001',
		timestampUtc: '2026-06-24T17:00:00Z',
		executionMode: 'fixture',
		benchmarkName: 'rudolph-beacon',
		repo: {
			branch: 'test-branch',
			commitSha: 'abc123def456789',
			status: 'clean',
		},
		issues: [
			{
				id: 'BENCH-001',
				title: 'Domain Baseline',
				status: 'DONE',
				evidencePaths: ['evidence/test.json'],
				testNames: ['beacon-domain.test.ts'],
				changedFiles: ['src/beacon-domain.ts'],
				confidence: 0.95,
			},
			{
				id: 'BENCH-002',
				title: 'Deterministic Scan',
				status: 'DONE',
				evidencePaths: ['evidence/test2.json'],
				testNames: ['beacon-fixtures.test.ts'],
				changedFiles: ['src/beacon-fixtures.ts'],
				confidence: 0.9,
			},
		],
		commands: [
			{
				name: 'npm test',
				command: 'vitest run',
				exitCode: 0,
				durationMs: 2500,
			},
		],
		tests: {
			passed: 91,
			failed: 0,
			skipped: 0,
			redTestsCovered: ['Red Test 1', 'Red Test 2'],
		},
		safety: {
			secretsRedacted: true,
			blockedActions: [],
			warnings: [],
		},
		conclusion: {
			status: 'GREEN',
			whatWorks: ['BENCH-001: Domain Baseline'],
			whatDoesNotWork: [],
			whatIsUnproven: [],
			confidence: 0.93,
		},
		capabilityDelta: {
			newCapabilities: ['Schema validation'],
			removedBlockers: [],
			unchangedLimitations: [],
			remainingRisks: [],
			nextBestStep: 'Extend to real mode',
		},
	};
}

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe('Evidence Schema Validation', () => {
	// ── Valid summary ──────────────────────────────────────────────────
	describe('Valid summary passes all checks', () => {
		it('valid summary produces zero validation errors', () => {
			const summary = createValidSummary();
			const errors = validateRunSummary(summary);
			expect(errors).toHaveLength(0);
		});

		it('valid summary serializes to JSON with no lost fields', () => {
			const summary = createValidSummary();
			const json = JSON.stringify(summary);
			const parsed = JSON.parse(json);
			const errors = validateRunSummary(parsed);
			expect(errors).toHaveLength(0);
		});
	});

	// ── Required fields ────────────────────────────────────────────────
	describe('Required fields are enforced', () => {
		it('missing runId is rejected', () => {
			const summary = createValidSummary();
			const obj = { ...summary, runId: '' };
			const errors = validateRunSummary(obj);
			expect(errors.some((e) => e.includes('runId'))).toBe(true);
		});

		it('missing timestampUtc is rejected', () => {
			const summary = createValidSummary();
			const obj = { ...summary, timestampUtc: '' };
			const errors = validateRunSummary(obj);
			expect(errors.some((e) => e.includes('timestampUtc'))).toBe(true);
		});

		it('invalid executionMode is rejected', () => {
			const summary = createValidSummary();
			const obj = { ...summary, executionMode: 'invalid-mode' as 'fixture' };
			const errors = validateRunSummary(obj);
			expect(errors.some((e) => e.includes('executionMode'))).toBe(true);
		});

		it('wrong benchmarkName is rejected', () => {
			const summary = createValidSummary();
			const obj = { ...summary, benchmarkName: 'wrong-benchmark' as 'rudolph-beacon' };
			const errors = validateRunSummary(obj);
			expect(errors.some((e) => e.includes('benchmarkName'))).toBe(true);
		});

		it('missing repo is rejected', () => {
			const summary = { ...createValidSummary(), repo: undefined };
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('repo'))).toBe(true);
		});

		it('invalid repo.status is rejected', () => {
			const summary = createValidSummary();
			summary.repo.status = 'invalid' as 'clean';
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('repo.status'))).toBe(true);
		});

		it('missing conclusion is rejected', () => {
			const summary = { ...createValidSummary(), conclusion: undefined };
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('conclusion'))).toBe(true);
		});

		it('null input is rejected', () => {
			const errors = validateRunSummary(null);
			expect(errors.some((e) => e.includes('not an object'))).toBe(true);
		});

		it('non-object input is rejected', () => {
			const errors = validateRunSummary('not-an-object');
			expect(errors.some((e) => e.includes('not an object'))).toBe(true);
		});
	});

	// ── Issue validation ───────────────────────────────────────────────
	describe('Issue validation', () => {
		it('DONE without evidence is rejected', () => {
			const summary = createValidSummary();
			summary.issues[0] = {
				id: 'BENCH-001',
				title: 'Test',
				status: 'DONE',
				evidencePaths: [], // empty!
				testNames: [],
				changedFiles: [],
				confidence: 0.9,
			};
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('DONE') && e.includes('no evidence'))).toBe(true);
		});

		it('invalid issue status is rejected', () => {
			const summary = createValidSummary();
			summary.issues[0] = {
				id: 'BENCH-001',
				title: 'Test',
				status: 'INVALID' as 'DONE',
				evidencePaths: ['evidence/test.json'],
				testNames: [],
				changedFiles: [],
				confidence: 0.9,
			};
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('issues[0].status'))).toBe(true);
		});

		it('confidence below 0 is rejected', () => {
			const summary = createValidSummary();
			summary.issues[0]!.confidence = -0.1;
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('confidence'))).toBe(true);
		});

		it('confidence above 1 is rejected', () => {
			const summary = createValidSummary();
			summary.issues[0]!.confidence = 1.5;
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('confidence'))).toBe(true);
		});

		it('missing issue id is rejected', () => {
			const summary = createValidSummary();
			summary.issues[0]! = {
				id: '',
				title: 'Test',
				status: 'DONE',
				evidencePaths: ['evidence/test.json'],
				testNames: [],
				changedFiles: [],
				confidence: 0.9,
			};
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('.id'))).toBe(true);
		});
	});

	// ── Conclusion validation ──────────────────────────────────────────
	describe('Conclusion validation', () => {
		it('invalid conclusion status is rejected', () => {
			const summary = createValidSummary();
			summary.conclusion.status = 'BLUE' as 'GREEN';
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('conclusion.status'))).toBe(true);
		});

		it('conclusion.confidence outside 0-1 is rejected', () => {
			const summary = createValidSummary();
			summary.conclusion.confidence = 2.0;
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('conclusion.confidence'))).toBe(true);
		});

		it('GREEN with UNKNOWN_EVIDENCE issue is rejected', () => {
			const summary = createValidSummary();
			summary.issues[0]!.status = 'UNKNOWN_EVIDENCE';
			summary.issues[1]!.status = 'UNKNOWN_EVIDENCE';
			// Still GREEN
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('GREEN requires all issues DONE'))).toBe(true);
		});

		it('GREEN with low-confidence issue is rejected', () => {
			const summary = createValidSummary();
			summary.issues[0]!.confidence = 0.5; // below 0.7
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('GREEN requires'))).toBe(true);
		});
	});

	// ── Secret detection in evidence ───────────────────────────────────
	describe('Secret detection in serialized evidence', () => {
		it('valid summary JSON contains no secrets', () => {
			const summary = createValidSummary();
			const json = JSON.stringify(summary);
			expect(containsSecrets(json)).toBe(false);
		});

		it('summary with fake secret in a string field is detected', () => {
			// Construct a summary that has a fake secret embedded
			const summary = createValidSummary();
			// Put a fake GitHub token in a warning
			summary.safety.warnings = ['Token found: ghp_abcdef123456789012345678901234567890'];
			const json = JSON.stringify(summary);
			expect(containsSecrets(json)).toBe(true);
		});

		it('executionMode is always present in valid summary', () => {
			const summary = createValidSummary();
			expect(summary.executionMode).toBe('fixture');
			for (const mode of ['dry-run', 'real']) {
				const s = createValidSummary();
				s.executionMode = mode as 'fixture';
				expect(s.executionMode).toBe(mode);
			}
		});
	});

	// ── Validate existing fixture summary ─────────────────────────────
	describe('Existing fixture summary validation', () => {
		it('run-summary.fixture.json passes schema validation', () => {
			const fixturePath = join(
				process.cwd(),
				'docs',
				'evidence',
				'rudolph-beacon',
				'run-summary.fixture.json',
			);

			if (!existsSync(fixturePath)) {
				// Skip test if fixture file not found (CI or different working dir)
				// Using dynamic skip pattern — test is marked as skipped, not silently passed
				expect.fail(`Fixture file not found at: ${fixturePath} — cannot validate schema`);
				return;
			}

			const raw = readFileSync(fixturePath, 'utf-8');
			const summary = JSON.parse(raw);
			const errors = validateRunSummary(summary);

			if (errors.length > 0) {
				console.error('Fixture validation errors:', errors);
			}
			expect(errors).toHaveLength(0);
		});

		it('run-summary.dry-run.json passes schema validation', () => {
			const dryRunPath = join(
				process.cwd(),
				'docs',
				'evidence',
				'rudolph-beacon',
				'run-summary.dry-run.json',
			);

			if (!existsSync(dryRunPath)) {
				expect.fail(`Dry-run file not found at: ${dryRunPath} — cannot validate schema`);
				return;
			}

			const raw = readFileSync(dryRunPath, 'utf-8');
			const summary = JSON.parse(raw);
			const errors = validateRunSummary(summary);

			if (errors.length > 0) {
				console.error('Dry-run validation errors:', errors);
			}
			expect(errors).toHaveLength(0);
		});
	});

	// ── capabilityDelta validation ─────────────────────────────────────
	describe('Capability delta validation', () => {
		it('missing newCapabilities is rejected', () => {
			const summary = createValidSummary();
			summary.capabilityDelta = {
				...summary.capabilityDelta,
				newCapabilities: undefined as unknown as string[],
			};
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('newCapabilities'))).toBe(true);
		});

		it('missing nextBestStep is rejected', () => {
			const summary = createValidSummary();
			summary.capabilityDelta.nextBestStep = '';
			const errors = validateRunSummary(summary);
			expect(errors.some((e) => e.includes('nextBestStep'))).toBe(true);
		});

		it('valid delta produces no errors', () => {
			const summary = createValidSummary();
			const errors = validateRunSummary(summary);
			expect(errors).toHaveLength(0);
		});
	});

	// ── Edge cases ─────────────────────────────────────────────────────
	describe('Edge cases', () => {
		it('empty issues array is valid', () => {
			const summary = createValidSummary();
			summary.issues = [];
			// Recalculate conclusion for empty issues
			summary.conclusion = {
				status: determineConclusionStatus(summary.issues),
				whatWorks: [],
				whatDoesNotWork: [],
				whatIsUnproven: [],
				confidence: 0,
			};
			const errors = validateRunSummary(summary);
			expect(errors).toHaveLength(0);
		});

		it('BLOCKED issue with evidence is valid', () => {
			const summary = createValidSummary();
			summary.issues = [
				{
					id: 'BENCH-001',
					title: 'Blocked Issue',
					status: 'BLOCKED',
					evidencePaths: ['evidence/blocker.json'],
					testNames: [],
					changedFiles: [],
					confidence: 0,
				},
			];
			const errors = validateRunSummary(summary);
			// BLOCKED does NOT require evidence (per schema), so this should pass
			expect(errors.filter((e) => !e.includes('GREEN requires'))).toHaveLength(0);
		});

		it('UNKNOWN_EVIDENCE with confidence 0 is valid', () => {
			const summary = createValidSummary();
			summary.issues[0]!.status = 'UNKNOWN_EVIDENCE';
			summary.issues[0]!.confidence = 0;
			summary.issues[0]!.evidencePaths = [];
			const errors = validateRunSummary(summary);
			// Only the "GREEN requires" error for the mixed-status case
			const nonGreenErrors = errors.filter((e) => !e.includes('GREEN requires'));
			expect(nonGreenErrors).toHaveLength(0);
		});

		it('all execution modes are valid', () => {
			for (const mode of VALID_EXECUTION_MODES) {
				const summary = createValidSummary();
				summary.executionMode = mode;
				summary.runId = `schema-test-${mode}`;
				const errors = validateRunSummary(summary);
				expect(errors).toHaveLength(0);
			}
		});
	});
});
