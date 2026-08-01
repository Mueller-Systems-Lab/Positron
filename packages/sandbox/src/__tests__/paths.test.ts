// Positron — Paths: Comprehensive branch coverage tests
// Covers: createPositronBranchName, validatePath, validateRemoteUrl,
//         GitWorkspacePathError, GitRemoteInvalidError, createWorkspacePath

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	GitRemoteInvalidError,
	GitWorkspacePathError,
	createPositronBranchName,
	createWorkspacePath,
	validatePath,
	validateRemoteUrl,
} from '../paths.js';

const originalEnv = { ...process.env };

beforeEach(() => {
	Reflect.deleteProperty(process.env, 'POSITRON_WORKSPACE_ROOT');
});

afterEach(() => {
	process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// createPositronBranchName
// ---------------------------------------------------------------------------
describe('createPositronBranchName', () => {
	test('creates branch from normal title', () => {
		const branch = createPositronBranchName(42, 'Test Issue');
		expect(branch).toBe('positron/issue-42-test-issue');
	});

	test('handles special characters in title', () => {
		const branch = createPositronBranchName(42, 'Fix: Something (urgent)!');
		expect(branch).toContain('positron/issue-42-fix-something-urgent');
		// Should not contain non-alphanumeric chars
		expect(branch).not.toMatch(/[():!]/);
	});

	test('strips leading hyphens from slug', () => {
		// Title starting with special chars would produce leading hyphens
		const branch = createPositronBranchName(42, '-test-');
		expect(branch).toBe('positron/issue-42-test');
		// No leading or trailing hyphens in the slug part
		expect(branch).not.toContain('--');
		expect(branch).not.toMatch(/-$/);
	});

	test('strips trailing hyphens from slug', () => {
		const branch = createPositronBranchName(42, 'test--');
		expect(branch).toBe('positron/issue-42-test');
	});

	test('limits slug to 50 characters', () => {
		const longTitle = 'a'.repeat(100);
		const branch = createPositronBranchName(42, longTitle);
		const slug = branch.split('issue-42-')[1]!;
		expect(slug.length).toBeLessThanOrEqual(50);
	});
});

// ---------------------------------------------------------------------------
// validatePath
// ---------------------------------------------------------------------------
describe('validatePath', () => {
	test('accepts valid absolute path', () => {
		expect(() => validatePath('/valid/path')).not.toThrow();
	});

	test('throws for empty string', () => {
		expect(() => validatePath('')).toThrow(GitWorkspacePathError);
	});

	test('throws for whitepsace-only', () => {
		expect(() => validatePath('  ')).toThrow(GitWorkspacePathError);
	});

	test('throws path with .. traversal', () => {
		expect(() => validatePath('/path/with/../dots')).toThrow(GitWorkspacePathError);
	});

	test('throws for double-dot at start', () => {
		expect(() => validatePath('../escape')).toThrow();
	});

	test('throws for relative path', () => {
		expect(() => validatePath('relative/path')).toThrow(GitWorkspacePathError);
	});
});

// ---------------------------------------------------------------------------
// validateRemoteUrl
// ---------------------------------------------------------------------------
describe('validateRemoteUrl', () => {
	test('accepts valid https URL', () => {
		expect(() => validateRemoteUrl('https://github.com/test.git')).not.toThrow();
	});

	test('accepts valid http URL', () => {
		expect(() => validateRemoteUrl('http://example.com/repo.git')).not.toThrow();
	});

	test('throws for empty string', () => {
		expect(() => validateRemoteUrl('')).toThrow(GitRemoteInvalidError);
	});

	test('throws for space-only string', () => {
		expect(() => validateRemoteUrl('   ')).toThrow(GitRemoteInvalidError);
	});

	test('throws for invalid URL format', () => {
		expect(() => validateRemoteUrl('not-a-url')).toThrow(GitRemoteInvalidError);
	});

	test('throws for nonsense string', () => {
		expect(() => validateRemoteUrl('xyz')).toThrow(GitRemoteInvalidError);
	});
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------
describe('GitWorkspacePathError', () => {
	test('has correct name', () => {
		const err = new GitWorkspacePathError('test');
		expect(err.name).toBe('GitWorkspacePathError');
	});

	test('has correct message', () => {
		const err = new GitWorkspacePathError('custom message');
		expect(err.message).toBe('custom message');
	});

	test('is instance of Error', () => {
		const err = new GitWorkspacePathError('test');
		expect(err).toBeInstanceOf(Error);
	});
});

describe('GitRemoteInvalidError', () => {
	test('has correct name', () => {
		const err = new GitRemoteInvalidError('test');
		expect(err.name).toBe('GitRemoteInvalidError');
	});

	test('has correct message', () => {
		const err = new GitRemoteInvalidError('custom message');
		expect(err.message).toBe('custom message');
	});

	test('is instance of Error', () => {
		const err = new GitRemoteInvalidError('test');
		expect(err).toBeInstanceOf(Error);
	});
});

// ---------------------------------------------------------------------------
// createWorkspacePath — covers nullish coalescing chain
// ---------------------------------------------------------------------------
describe('createWorkspacePath', () => {
	test('uses provided workspaceRoot', () => {
		const p = createWorkspacePath('abc12345-def', '/custom/root');
		expect(p).toContain(path.normalize('/custom/root/abc12345'));
	});

	test('falls back to POSITRON_WORKSPACE_ROOT env var when no arg provided', () => {
		process.env['POSITRON_WORKSPACE_ROOT'] = '/env/workspace';
		const p = createWorkspacePath('abc12345-def');
		expect(p).toContain(path.normalize('/env/workspace/abc12345'));
	});

	test('falls back to DEFAULT_WORKSPACE_ROOT when no arg and no env', () => {
		const p = createWorkspacePath('abc12345-def');
		// Should use the default path (homeDir/.positron/workspaces)
		expect(p).toContain('abc12345');
		expect(p).toContain('.positron');
	});
});
