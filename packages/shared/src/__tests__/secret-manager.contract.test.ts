/**
 * Secret Manager Contract Tests (QA-023)
 *
 * Verifies the PUBLIC API contract of @positron/shared's SecretManager.
 * Tests exported behavior guarantees for secret providers and manager.
 *
 * Contract guarantees:
 * - EnvSecretProvider reads from process.env
 * - FileSecretProvider parses .env files correctly
 * - SecretManager resolves secrets in provider chain order
 * - SecretManager returns null for missing secrets
 * - SecretManager.mask() never reveals secret values
 * - SecretManager.maskValue() delegates to redactSecrets
 * - SecretManager.hasSecret() returns correct availability
 * - SecretManager.getProviderNames() lists all providers
 *
 * SECURITY: No real secrets. All values are fakes in test scope only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SecretProvider } from '@positron/shared';
import { EnvSecretProvider, FileSecretProvider, SecretManager } from '@positron/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempEnvFile(content: string): string {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-contract-'));
	const filePath = path.join(tmpDir, '.env');
	fs.writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

function cleanupTempDir(filePath: string): void {
	const dir = path.dirname(filePath);
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// best effort cleanup
	}
}

// Fake provider for testing the chain
class FakeProvider implements SecretProvider {
	readonly name: string;
	private secrets: Record<string, string>;

	constructor(name: string, secrets: Record<string, string> = {}) {
		this.name = name;
		this.secrets = secrets;
	}

	getSecret(key: string): string | null {
		return this.secrets[key] ?? null;
	}
}

// ---------------------------------------------------------------------------
// Contract: EnvSecretProvider
// ---------------------------------------------------------------------------
describe('EnvSecretProvider contract', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Clean up any test keys
		Reflect.deleteProperty(process.env, 'TEST_CONTRACT_KEY');
		Reflect.deleteProperty(process.env, 'TEST_CONTRACT_EMPTY');
	});

	afterEach(() => {
		// Restore original env
		process.env = { ...originalEnv };
	});

	it('has name "env"', () => {
		const provider = new EnvSecretProvider();
		expect(provider.name).toBe('env');
	});

	it('returns value when env var is set', () => {
		process.env.TEST_CONTRACT_KEY = 'my-secret-value';
		const provider = new EnvSecretProvider();
		expect(provider.getSecret('TEST_CONTRACT_KEY')).toBe('my-secret-value');
	});

	it('returns null when env var is not set', () => {
		Reflect.deleteProperty(process.env, 'TEST_CONTRACT_KEY');
		const provider = new EnvSecretProvider();
		expect(provider.getSecret('TEST_CONTRACT_KEY')).toBeNull();
	});

	it('returns null for empty string env var (delegates to manager filter)', () => {
		// EnvSecretProvider returns the raw value; filtering happens in SecretManager
		process.env.TEST_CONTRACT_EMPTY = '';
		const provider = new EnvSecretProvider();
		expect(provider.getSecret('TEST_CONTRACT_EMPTY')).toBe('');
	});

	it('implements SecretProvider interface', () => {
		const provider = new EnvSecretProvider();
		expect(provider).toHaveProperty('name');
		expect(typeof provider.getSecret).toBe('function');
	});
});

// ---------------------------------------------------------------------------
// Contract: FileSecretProvider
// ---------------------------------------------------------------------------
describe('FileSecretProvider contract', () => {
	it('has name "file"', () => {
		const tmpFile = createTempEnvFile('KEY=value');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.name).toBe('file');
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('parses simple KEY=VALUE lines', () => {
		const tmpFile = createTempEnvFile('TOKEN=abc123\nSECRET=xyz789');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('TOKEN')).toBe('abc123');
			expect(provider.getSecret('SECRET')).toBe('xyz789');
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('returns null for missing keys', () => {
		const tmpFile = createTempEnvFile('EXISTS=yes');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('MISSING')).toBeNull();
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('ignores comment lines starting with #', () => {
		const tmpFile = createTempEnvFile('# this is a comment\nREAL_KEY=value');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('REAL_KEY')).toBe('value');
			// '#' key should not exist
			expect(provider.getSecret('# this')).toBeNull();
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('ignores blank lines', () => {
		const tmpFile = createTempEnvFile('\n\nKEY=value\n\n');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('KEY')).toBe('value');
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('removes surrounding double quotes from values', () => {
		const tmpFile = createTempEnvFile('QUOTED="value with spaces"');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('QUOTED')).toBe('value with spaces');
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('removes surrounding single quotes from values', () => {
		const tmpFile = createTempEnvFile("SINGLE='quoted value'");
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('SINGLE')).toBe('quoted value');
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('caches parsed content (only parses once)', () => {
		const tmpFile = createTempEnvFile('CACHED=first');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('CACHED')).toBe('first');

			// Modify the file on disk
			fs.writeFileSync(tmpFile, 'CACHED=second', 'utf-8');
			// Cached result should still be 'first'
			expect(provider.getSecret('CACHED')).toBe('first');
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('returns null for non-existent file', () => {
		const provider = new FileSecretProvider('/tmp/non-existent-positron-contract.env');
		expect(provider.getSecret('ANYTHING')).toBeNull();
	});

	it('returns null for empty file', () => {
		const tmpFile = createTempEnvFile('');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('ANYTHING')).toBeNull();
		} finally {
			cleanupTempDir(tmpFile);
		}
	});

	it('implements SecretProvider interface', () => {
		const tmpFile = createTempEnvFile('KEY=val');
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider).toHaveProperty('name');
			expect(typeof provider.getSecret).toBe('function');
		} finally {
			cleanupTempDir(tmpFile);
		}
	});
});

// ---------------------------------------------------------------------------
// Contract: SecretManager
// ---------------------------------------------------------------------------
describe('SecretManager contract', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		Reflect.deleteProperty(process.env, 'TEST_SECRET_1');
		Reflect.deleteProperty(process.env, 'TEST_SECRET_2');
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	describe('provider chain resolution', () => {
		it('resolves from first provider that has the value', () => {
			const p1 = new FakeProvider('first', { KEY: 'from-first' });
			const p2 = new FakeProvider('second', { KEY: 'from-second' });
			const sm = new SecretManager({ providers: [p1, p2] });

			expect(sm.getSecret('KEY')).toBe('from-first');
		});

		it('falls through to next provider when first returns null', () => {
			const p1 = new FakeProvider('first', {}); // no keys
			const p2 = new FakeProvider('second', { KEY: 'from-second' });
			const sm = new SecretManager({ providers: [p1, p2] });

			expect(sm.getSecret('KEY')).toBe('from-second');
		});

		it('returns null when no provider has the value', () => {
			const p1 = new FakeProvider('first', {});
			const p2 = new FakeProvider('second', {});
			const sm = new SecretManager({ providers: [p1, p2] });

			expect(sm.getSecret('UNKNOWN')).toBeNull();
		});

		it('skips empty string values from providers', () => {
			const p1 = new FakeProvider('first', { KEY: '' });
			const p2 = new FakeProvider('second', { KEY: 'from-second' });
			const sm = new SecretManager({ providers: [p1, p2] });

			// Empty string should be skipped, fall through to p2
			expect(sm.getSecret('KEY')).toBe('from-second');
		});
	});

	describe('mask() contract', () => {
		it('returns "<not set>" for missing secrets', () => {
			const sm = new SecretManager({ providers: [] });
			expect(sm.mask('MISSING')).toBe('MISSING=<not set>');
		});

		it('returns redacted format for present secrets (NEVER reveals value)', () => {
			const p = new FakeProvider('test', { TOKEN: 'super-secret-value' });
			const sm = new SecretManager({ providers: [p] });

			const result = sm.mask('TOKEN');
			expect(result).not.toContain('super-secret-value');
			expect(result).toContain('***-redacted-***');
			expect(result).toContain('TOKEN=');
		});
	});

	describe('maskValue() contract', () => {
		it('delegates to redactSecrets for secret patterns', () => {
			const sm = new SecretManager({ providers: [] });
			const input = 'token=ghp_abcdefghijklmnopqrstuvwxyz1234567890';
			const result = sm.maskValue(input);

			expect(result).toContain('***REDACTED***');
			expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
		});

		it('returns plain text unchanged when no secrets present', () => {
			const sm = new SecretManager({ providers: [] });
			expect(sm.maskValue('hello world')).toBe('hello world');
		});
	});

	describe('hasSecret() contract', () => {
		it('returns true when secret is available', () => {
			const p = new FakeProvider('test', { EXISTS: 'yes' });
			const sm = new SecretManager({ providers: [p] });

			expect(sm.hasSecret('EXISTS')).toBe(true);
		});

		it('returns false when secret is not available', () => {
			const sm = new SecretManager({ providers: [] });
			expect(sm.hasSecret('MISSING')).toBe(false);
		});
	});

	describe('getProviderNames() contract', () => {
		it('returns list of all provider names in order', () => {
			const p1 = new FakeProvider('alpha', {});
			const p2 = new FakeProvider('beta', {});
			const sm = new SecretManager({ providers: [p1, p2] });

			expect(sm.getProviderNames()).toEqual(['alpha', 'beta']);
		});

		it('returns empty array when no providers', () => {
			const sm = new SecretManager({ providers: [] });
			expect(sm.getProviderNames()).toEqual([]);
		});

		it('default providers have expected names', () => {
			const sm = new SecretManager();
			const names = sm.getProviderNames();
			expect(names.length).toBeGreaterThanOrEqual(1);
			expect(names[0]).toBe('env');
		});
	});

	describe('constructor defaults', () => {
		it('creates a working instance without arguments', () => {
			const sm = new SecretManager();
			expect(sm).toBeInstanceOf(SecretManager);
			expect(sm.getProviderNames().length).toBeGreaterThan(0);
		});

		it('accepts custom env file path', () => {
			const tmpFile = createTempEnvFile('CUSTOM=from-file');
			try {
				const sm = new SecretManager({ envFilePath: tmpFile });
				expect(sm.getSecret('CUSTOM')).toBe('from-file');
			} finally {
				cleanupTempDir(tmpFile);
			}
		});
	});
});
