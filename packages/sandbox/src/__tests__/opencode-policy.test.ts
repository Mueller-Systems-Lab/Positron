// Positron — OpenCode Policy: Comprehensive branch coverage tests
// Covers: validateOpenCodeCommand, OpenCodeCommandPolicyError,
//         ALLOWED_OPENCODE_COMMANDS, BLOCKED_OPENCODE_COMMANDS, ALLOWED_SLASH_COMMANDS

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	ALLOWED_OPENCODE_COMMANDS,
	ALLOWED_SLASH_COMMANDS,
	BLOCKED_OPENCODE_COMMANDS,
	OpenCodeCommandPolicyError,
	validateOpenCodeCommand,
} from '../opencode-policy.js';

const originalEnv = { ...process.env };

beforeEach(() => {
	Reflect.deleteProperty(process.env, 'POSITRON_OPENCODE_MODE');
});

afterEach(() => {
	process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// validateOpenCodeCommand
// ---------------------------------------------------------------------------
describe('validateOpenCodeCommand', () => {
	test('throws in fake mode (default)', () => {
		expect(() => validateOpenCodeCommand('opencode run')).toThrow(OpenCodeCommandPolicyError);
		expect(() => validateOpenCodeCommand('opencode run')).toThrow('fake mode');
	});

	test('throws when POSITRON_OPENCODE_MODE is explicitly fake', () => {
		process.env['POSITRON_OPENCODE_MODE'] = 'fake';
		expect(() => validateOpenCodeCommand('opencode')).toThrow(OpenCodeCommandPolicyError);
	});

	test('throws for blocked command', () => {
		process.env['POSITRON_OPENCODE_MODE'] = 'real';
		expect(() => validateOpenCodeCommand('opencode --dangerous')).toThrow(
			OpenCodeCommandPolicyError,
		);
		expect(() => validateOpenCodeCommand('opencode --dangerous')).toThrow('blocked by policy');
	});

	test('throws for other blocked command', () => {
		process.env['POSITRON_OPENCODE_MODE'] = 'real';
		expect(() => validateOpenCodeCommand('opencode --unsafe')).toThrow(OpenCodeCommandPolicyError);
	});

	test('throws for --allow-all', () => {
		process.env['POSITRON_OPENCODE_MODE'] = 'real';
		expect(() => validateOpenCodeCommand('opencode --allow-all stuff')).toThrow(
			OpenCodeCommandPolicyError,
		);
	});

	test('does not throw for allowed command in real mode', () => {
		process.env['POSITRON_OPENCODE_MODE'] = 'real';
		expect(() => validateOpenCodeCommand('opencode run')).not.toThrow();
	});

	test('does not throw for --version in real mode', () => {
		process.env['POSITRON_OPENCODE_MODE'] = 'real';
		expect(() => validateOpenCodeCommand('opencode --version')).not.toThrow();
	});

	test('does not throw for --help in real mode', () => {
		process.env['POSITRON_OPENCODE_MODE'] = 'real';
		expect(() => validateOpenCodeCommand('opencode --help')).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// OpenCodeCommandPolicyError
// ---------------------------------------------------------------------------
describe('OpenCodeCommandPolicyError', () => {
	test('has correct name', () => {
		const err = new OpenCodeCommandPolicyError('test');
		expect(err.name).toBe('OpenCodeCommandPolicyError');
	});

	test('has correct message', () => {
		const err = new OpenCodeCommandPolicyError('custom error');
		expect(err.message).toBe('custom error');
	});

	test('is instance of Error', () => {
		const err = new OpenCodeCommandPolicyError('test');
		expect(err).toBeInstanceOf(Error);
	});
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
	test('ALLOWED_OPENCODE_COMMANDS is a non-empty array', () => {
		expect(ALLOWED_OPENCODE_COMMANDS.length).toBeGreaterThan(0);
		expect(ALLOWED_OPENCODE_COMMANDS).toContain('opencode');
	});

	test('BLOCKED_OPENCODE_COMMANDS is a non-empty array', () => {
		expect(BLOCKED_OPENCODE_COMMANDS.length).toBeGreaterThan(0);
		expect(BLOCKED_OPENCODE_COMMANDS).toContain('opencode --dangerous');
	});

	test('ALLOWED_SLASH_COMMANDS is a non-empty array', () => {
		expect(ALLOWED_SLASH_COMMANDS.length).toBeGreaterThan(0);
		expect(ALLOWED_SLASH_COMMANDS).toContain('speckit.specify');
	});
});
