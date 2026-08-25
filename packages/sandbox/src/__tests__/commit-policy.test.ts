// Positron — Commit Policy: Comprehensive branch coverage tests
// Covers: guardBranch, evaluatePushPolicy, generateCommitMessage, isValidPositronBranch

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	ALLOWED_BRANCH_PATTERN,
	evaluatePushPolicy,
	generateCommitMessage,
	guardBranch,
	isValidPositronBranch,
	PROTECTED_BRANCHES,
} from '../commit-policy.js';

// ---------------------------------------------------------------------------
// guardBranch
// ---------------------------------------------------------------------------
describe('guardBranch', () => {
	test('rejects empty branch', () => {
		const result = guardBranch('');
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe('Branch name is empty');
	});

	test('rejects main branch', () => {
		const result = guardBranch('main');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('protected');
	});

	test('rejects master branch', () => {
		const result = guardBranch('master');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('protected');
	});

	test('rejects develop branch', () => {
		const result = guardBranch('develop');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('protected');
	});

	test('allows positron/ prefix even without matching exact pattern', () => {
		// guardBranch allows anything starting with positron/ per policy
		const result = guardBranch('positron/random-branch');
		expect(result.allowed).toBe(true);
	});

	test('rejects branch with neither positron/ nor valid pattern', () => {
		const result = guardBranch('feature/something');
		expect(result.allowed).toBe(false);
	});

	test('allows valid positron/issue-* branch', () => {
		const result = guardBranch('positron/issue-42-test');
		expect(result.allowed).toBe(true);
	});

	test('allows positron/issue- with multiple digits', () => {
		const result = guardBranch('positron/issue-123-feature-name');
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// evaluatePushPolicy
// ---------------------------------------------------------------------------
describe('evaluatePushPolicy', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		Reflect.deleteProperty(process.env, 'POSITRON_ENABLE_PUSH');
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	test('blocks protected branch main', () => {
		const result = evaluatePushPolicy('main', []);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('protected');
	});

	test('blocks protected branch master', () => {
		const result = evaluatePushPolicy('master', []);
		expect(result.allowed).toBe(false);
	});

	test('blocks force flag', () => {
		const result = evaluatePushPolicy('positron/issue-42-test', ['--force']);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('--force');
	});

	test('blocks -f flag', () => {
		const result = evaluatePushPolicy('positron/issue-42-test', ['-f']);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('-f');
	});

	test('blocks --force-with-lease flag', () => {
		const result = evaluatePushPolicy('positron/issue-42-test', ['--force-with-lease']);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('--force-with-lease');
	});

	test('blocks when POSITRON_ENABLE_PUSH is not set', () => {
		const result = evaluatePushPolicy('positron/issue-42-test', []);
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe('POSITRON_ENABLE_PUSH is not set to "true"');
	});

	test('blocks when POSITRON_ENABLE_PUSH is false string', () => {
		process.env['POSITRON_ENABLE_PUSH'] = 'false';
		const result = evaluatePushPolicy('positron/issue-42-test', []);
		expect(result.allowed).toBe(false);
	});

	test('allows when POSITRON_ENABLE_PUSH is true and valid branch with no blocked flags', () => {
		process.env['POSITRON_ENABLE_PUSH'] = 'true';
		const result = evaluatePushPolicy('positron/issue-42-test', []);
		expect(result.allowed).toBe(true);
	});

	test('allows with valid branch and allowed flags', () => {
		process.env['POSITRON_ENABLE_PUSH'] = 'true';
		const result = evaluatePushPolicy('positron/issue-42-test', ['--set-upstream', '-v']);
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// generateCommitMessage
// ---------------------------------------------------------------------------
describe('generateCommitMessage', () => {
	test('generates correct format', () => {
		const msg = generateCommitMessage(42, 'fix the thing');
		expect(msg).toContain('feat(issue-42)');
		expect(msg).toContain('fix the thing');
		expect(msg).toContain('Automated by Positron');
	});
});

// ---------------------------------------------------------------------------
// isValidPositronBranch
// ---------------------------------------------------------------------------
describe('isValidPositronBranch', () => {
	test('returns true for valid pattern', () => {
		expect(isValidPositronBranch('positron/issue-42-test')).toBe(true);
	});

	test('returns true for valid pattern with multiple digits', () => {
		expect(isValidPositronBranch('positron/issue-123-a-b-c')).toBe(true);
	});

	test('returns false for main', () => {
		expect(isValidPositronBranch('main')).toBe(false);
	});

	test('returns false for feature branch', () => {
		expect(isValidPositronBranch('feature/my-feature')).toBe(false);
	});

	test('returns false for empty string', () => {
		expect(isValidPositronBranch('')).toBe(false);
	});

	test('returns false for positron/ without issue number', () => {
		expect(isValidPositronBranch('positron/random')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
	test('PROTECTED_BRANCHES includes main, master, develop', () => {
		expect(PROTECTED_BRANCHES).toContain('main');
		expect(PROTECTED_BRANCHES).toContain('master');
		expect(PROTECTED_BRANCHES).toContain('develop');
	});

	test('ALLOWED_BRANCH_PATTERN matches correct format', () => {
		expect(ALLOWED_BRANCH_PATTERN.test('positron/issue-42-test')).toBe(true);
		expect(ALLOWED_BRANCH_PATTERN.test('main')).toBe(false);
	});
});
