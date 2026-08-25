// Positron — SpecKit Policy: Comprehensive branch coverage tests
// Covers: isAllowedSpecKitCommand, isBlockedSpecKitCommand,
//         validateSpecKitCommand, SpecKitCommandPolicyError,
//         ALLOWED_SPECKIT_COMMANDS, BLOCKED_SPECKIT_COMMANDS

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	ALLOWED_SPECKIT_COMMANDS,
	BLOCKED_SPECKIT_COMMANDS,
	isAllowedSpecKitCommand,
	isBlockedSpecKitCommand,
	SpecKitCommandPolicyError,
	validateSpecKitCommand,
} from '../speckit-policy.js';

const originalEnv = { ...process.env };

beforeEach(() => {
	Reflect.deleteProperty(process.env, 'POSITRON_SPECKIT_MODE');
});

afterEach(() => {
	process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// isAllowedSpecKitCommand
// ---------------------------------------------------------------------------
describe('isAllowedSpecKitCommand', () => {
	test('returns true for specify version', () => {
		expect(isAllowedSpecKitCommand('specify version')).toBe(true);
	});

	test('returns true for specify --version', () => {
		expect(isAllowedSpecKitCommand('specify --version')).toBe(true);
	});

	test('returns true for specify init', () => {
		expect(isAllowedSpecKitCommand('specify init')).toBe(true);
	});

	test('returns true for specify check', () => {
		expect(isAllowedSpecKitCommand('specify check')).toBe(true);
	});

	test('returns false for unknown command', () => {
		expect(isAllowedSpecKitCommand('specify --force')).toBe(false);
	});

	test('returns false for empty string', () => {
		expect(isAllowedSpecKitCommand('')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isBlockedSpecKitCommand
// ---------------------------------------------------------------------------
describe('isBlockedSpecKitCommand', () => {
	test('returns true for --force', () => {
		expect(isBlockedSpecKitCommand('specify --force')).toBe(true);
	});

	test('returns true for --dangerous', () => {
		expect(isBlockedSpecKitCommand('specify --dangerous')).toBe(true);
	});

	test('returns false for allowed command', () => {
		expect(isBlockedSpecKitCommand('specify version')).toBe(false);
	});

	test('returns false for empty string', () => {
		expect(isBlockedSpecKitCommand('')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// validateSpecKitCommand
// ---------------------------------------------------------------------------
describe('validateSpecKitCommand', () => {
	test('throws in fake mode (default)', () => {
		expect(() => validateSpecKitCommand('specify version')).toThrow(SpecKitCommandPolicyError);
		expect(() => validateSpecKitCommand('specify version')).toThrow('fake mode');
	});

	test('throws when POSITRON_SPECKIT_MODE is explicitly fake', () => {
		process.env['POSITRON_SPECKIT_MODE'] = 'fake';
		expect(() => validateSpecKitCommand('specify version')).toThrow(SpecKitCommandPolicyError);
	});

	test('throws for blocked command in real mode', () => {
		process.env['POSITRON_SPECKIT_MODE'] = 'real';
		expect(() => validateSpecKitCommand('specify --force')).toThrow(SpecKitCommandPolicyError);
		expect(() => validateSpecKitCommand('specify --force')).toThrow('blocked by policy');
	});

	test('throws for not-allowed command in real mode', () => {
		process.env['POSITRON_SPECKIT_MODE'] = 'real';
		expect(() => validateSpecKitCommand('specify unknown-command')).toThrow(
			SpecKitCommandPolicyError,
		);
		expect(() => validateSpecKitCommand('specify unknown-command')).toThrow(
			'not in the allowed list',
		);
	});

	test('does not throw for allowed command in real mode', () => {
		process.env['POSITRON_SPECKIT_MODE'] = 'real';
		expect(() => validateSpecKitCommand('specify version')).not.toThrow();
	});

	test('does not throw for specify check in real mode', () => {
		process.env['POSITRON_SPECKIT_MODE'] = 'real';
		expect(() => validateSpecKitCommand('specify check')).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// SpecKitCommandPolicyError
// ---------------------------------------------------------------------------
describe('SpecKitCommandPolicyError', () => {
	test('has correct name', () => {
		const err = new SpecKitCommandPolicyError('test');
		expect(err.name).toBe('SpecKitCommandPolicyError');
	});

	test('has correct message', () => {
		const err = new SpecKitCommandPolicyError('custom error');
		expect(err.message).toBe('custom error');
	});

	test('is instance of Error', () => {
		const err = new SpecKitCommandPolicyError('test');
		expect(err).toBeInstanceOf(Error);
	});
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
	test('ALLOWED_SPECKIT_COMMANDS is non-empty', () => {
		expect(ALLOWED_SPECKIT_COMMANDS.length).toBeGreaterThan(0);
	});

	test('BLOCKED_SPECKIT_COMMANDS is non-empty', () => {
		expect(BLOCKED_SPECKIT_COMMANDS.length).toBeGreaterThan(0);
		expect(BLOCKED_SPECKIT_COMMANDS).toContain('specify --force');
	});
});
