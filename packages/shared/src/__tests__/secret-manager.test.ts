import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	DockerSecretProvider,
	EnvSecretProvider,
	FileSecretProvider,
	SecretManager,
} from '../secret-manager.js';

// ---------------------------------------------------------------------------
// EnvSecretProvider
// ---------------------------------------------------------------------------
describe('EnvSecretProvider', () => {
	const provider = new EnvSecretProvider();

	test('reads existing env var', () => {
		process.env['TEST_SECRET_1'] = 'env-value-1';
		expect(provider.getSecret('TEST_SECRET_1')).toBe('env-value-1');
		Reflect.deleteProperty(process.env, 'TEST_SECRET_1');
	});

	test('returns null for missing env var', () => {
		expect(provider.getSecret('UNDEFINED_SECRET_12345')).toBeNull();
	});

	test('handles empty string env var', () => {
		process.env['EMPTY_SECRET'] = '';
		expect(provider.getSecret('EMPTY_SECRET')).toBe('');
		Reflect.deleteProperty(process.env, 'EMPTY_SECRET');
	});

	test('has correct provider name', () => {
		expect(provider.name).toBe('env');
	});
});

// ---------------------------------------------------------------------------
// DockerSecretProvider
// ---------------------------------------------------------------------------
describe('DockerSecretProvider', () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-test-'));
	const secretsDir = path.join(tmpDir, 'run-secrets');
	const provider = new DockerSecretProvider(secretsDir);

	beforeEach(() => {
		fs.mkdirSync(secretsDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('reads secret from file', () => {
		fs.writeFileSync(path.join(secretsDir, 'github_token'), 'my-docker-secret');
		expect(provider.getSecret('GITHUB_TOKEN')).toBe('my-docker-secret');
	});

	test('uses lowercase filename for lookup', () => {
		fs.writeFileSync(path.join(secretsDir, 'mixed_case_secret'), 'lowercase-value');
		expect(provider.getSecret('MIXED_CASE_SECRET')).toBe('lowercase-value');
	});

	test('returns null for missing secret file', () => {
		expect(provider.getSecret('NONEXISTENT_SECRET')).toBeNull();
	});

	test('trims whitespace from secret value', () => {
		fs.writeFileSync(path.join(secretsDir, 'trimmed'), '\n  my-value  \n');
		expect(provider.getSecret('TRIMMED')).toBe('my-value');
	});

	test('has correct provider name', () => {
		expect(provider.name).toBe('docker-secret');
	});
});

// ---------------------------------------------------------------------------
// FileSecretProvider
// ---------------------------------------------------------------------------
describe('FileSecretProvider', () => {
	let tmpDir: string;
	let envPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-test-'));
		envPath = path.join(tmpDir, '.env');
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('reads secrets from .env file', () => {
		fs.writeFileSync(envPath, 'MY_SECRET=my-value\nANOTHER=another-value\n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('MY_SECRET')).toBe('my-value');
		expect(provider.getSecret('ANOTHER')).toBe('another-value');
	});

	test('returns null for missing key', () => {
		fs.writeFileSync(envPath, 'EXISTING=yes\n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('MISSING_KEY')).toBeNull();
	});

	test('returns null for nonexistent file', () => {
		const provider = new FileSecretProvider(path.join(tmpDir, 'nonexistent.env'));
		expect(provider.getSecret('ANY_KEY')).toBeNull();
	});

	test('parses quoted values', () => {
		fs.writeFileSync(envPath, 'QUOTED="quoted-value"\nSINGLE=\'single-value\'\n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('QUOTED')).toBe('quoted-value');
		expect(provider.getSecret('SINGLE')).toBe('single-value');
	});

	test('skips comments and empty lines', () => {
		fs.writeFileSync(envPath, '# comment\n\nKEY=value\n# another comment\n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('KEY')).toBe('value');
		expect(provider.getSecret('comment')).toBeNull();
	});

	test('caches parsed file', () => {
		fs.writeFileSync(envPath, 'FIRST=original\n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('FIRST')).toBe('original');
		// Change file after first read — should still return cached value
		fs.writeFileSync(envPath, 'FIRST=changed\n');
		expect(provider.getSecret('FIRST')).toBe('original');
	});

	test('has correct provider name', () => {
		const provider = new FileSecretProvider(envPath);
		expect(provider.name).toBe('file');
	});
});

// ---------------------------------------------------------------------------
// SecretManager integration
// ---------------------------------------------------------------------------
describe('SecretManager', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-test-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		Reflect.deleteProperty(process.env, 'SM_TEST_VAR');
	});

	test('resolves from first provider that has value', () => {
		process.env['SM_TEST_VAR'] = 'from-env';
		const envFile = path.join(tmpDir, '.env');
		fs.writeFileSync(envFile, 'SM_TEST_VAR=from-file\n');
		// Order: env then file
		const sm = new SecretManager({
			providers: [new EnvSecretProvider(), new FileSecretProvider(envFile)],
		});
		expect(sm.getSecret('SM_TEST_VAR')).toBe('from-env');
	});

	test('falls back to second provider when first returns null', () => {
		Reflect.deleteProperty(process.env, 'SM_FALLBACK');
		const envFile = path.join(tmpDir, '.env');
		fs.writeFileSync(envFile, 'SM_FALLBACK=from-file\n');
		const sm = new SecretManager({
			providers: [new EnvSecretProvider(), new FileSecretProvider(envFile)],
		});
		expect(sm.getSecret('SM_FALLBACK')).toBe('from-file');
	});

	test('returns null when no provider has the secret', () => {
		const sm = new SecretManager({
			providers: [new EnvSecretProvider()],
		});
		expect(sm.getSecret('NONEXISTENT_SECRET_999')).toBeNull();
	});

	test('mask returns masked string for set secrets', () => {
		process.env['MASK_TEST'] = 'super-secret-value';
		const sm = new SecretManager({
			providers: [new EnvSecretProvider()],
		});
		expect(sm.mask('MASK_TEST')).toBe('MASK_TEST=***-redacted-***');
		Reflect.deleteProperty(process.env, 'MASK_TEST');
	});

	test('mask returns not-set for missing secrets', () => {
		const sm = new SecretManager({
			providers: [new EnvSecretProvider()],
		});
		expect(sm.mask('MISSING_MASK_TEST')).toBe('MISSING_MASK_TEST=<not set>');
	});

	test('maskValue redacts using default rules', () => {
		const sm = new SecretManager({
			providers: [new EnvSecretProvider()],
		});
		const result = sm.maskValue('My token is ghp_abcdefghijklmnopqrstuvwxyz0123456789abcd');
		expect(result).toContain('ghp_***REDACTED***');
		expect(result).not.toContain('ghp_abcdefgh');
	});

	test('hasSecret returns correct status', () => {
		process.env['HAS_SECRET_TEST'] = 'yes';
		const sm = new SecretManager({
			providers: [new EnvSecretProvider()],
		});
		expect(sm.hasSecret('HAS_SECRET_TEST')).toBe(true);
		expect(sm.hasSecret('NONEXISTENT')).toBe(false);
		Reflect.deleteProperty(process.env, 'HAS_SECRET_TEST');
	});

	test('getProviderNames returns configured providers', () => {
		const sm = new SecretManager({
			providers: [new EnvSecretProvider(), new FileSecretProvider(path.join(tmpDir, '.env'))],
		});
		expect(sm.getProviderNames()).toEqual(['env', 'file']);
	});

	test('skips empty string values when resolving', () => {
		process.env['EMPTY_RESOLVE'] = '';
		const envFile = path.join(tmpDir, '.env');
		fs.writeFileSync(envFile, 'EMPTY_RESOLVE=from-file\n');
		const sm = new SecretManager({
			providers: [new EnvSecretProvider(), new FileSecretProvider(envFile)],
		});
		// Empty string from env should count as "not found", fall through to file
		expect(sm.getSecret('EMPTY_RESOLVE')).toBe('from-file');
		Reflect.deleteProperty(process.env, 'EMPTY_RESOLVE');
	});

	test('default constructor creates SecretManager without error', () => {
		// Exercises resolveDefaultEnvPath() — NoCoverage target
		const sm = new SecretManager();
		const names = sm.getProviderNames();
		expect(names).toHaveLength(3); // env, docker, file
		expect(names[0]).toBe('env');
		expect(names[1]).toBe('docker-secret');
		expect(names[2]).toBe('file');
	});

	test('resolveDefaultEnvPath fallback when no .env files exist', () => {
		// Mock fs.existsSync to return false for all candidate paths
		const realExistsSync = fs.existsSync;
		const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
		try {
			const sm = new SecretManager();
			const names = sm.getProviderNames();
			expect(names).toHaveLength(3);
			// Fallback should still create providers, using candidates[0] path
		} finally {
			spy.mockRestore();
		}
	});
});

// ---------------------------------------------------------------------------
// FileSecretProvider — Edge Cases (QA-021)
// ---------------------------------------------------------------------------
describe('FileSecretProvider edge cases', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-edge-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('empty file returns null for any key', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, '');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('ANY_KEY')).toBeNull();
	});

	test('whitespace-only lines are ignored', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, '   \n\t\n  KEY=value  \n   \n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('KEY')).toBe('value');
	});

	test('spaces around = are trimmed from key and value', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, '  KEY  =  value  \n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('KEY')).toBe('value');
	});

	test('value containing = sign is preserved', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, 'CONN_STR=host=localhost;port=5432\n');
		const provider = new FileSecretProvider(envPath);
		// First = is delimiter between key and value
		expect(provider.getSecret('CONN_STR')).toBe('host=localhost;port=5432');
	});

	test('duplicate keys: last value wins (current contract)', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, 'KEY=first\nKEY=second\nKEY=third\n');
		const provider = new FileSecretProvider(envPath);
		// Current implementation: result[key] = value overwrites, last wins
		expect(provider.getSecret('KEY')).toBe('third');
	});

	test('lines without = sign are ignored', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, 'INVALID_LINE\nKEY=value\nANOTHER_INVALID\n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('KEY')).toBe('value');
		expect(provider.getSecret('INVALID_LINE')).toBeNull();
		expect(provider.getSecret('ANOTHER_INVALID')).toBeNull();
	});

	test('empty key after trimming is ignored', () => {
		const envPath = path.join(tmpDir, '.env');
		// =value with empty key
		fs.writeFileSync(envPath, '=empty-key\nVALID=present\n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('VALID')).toBe('present');
		// Empty key should not be stored (the `if (key)` guard)
	});

	test('export prefix is NOT stripped (current contract: treated literally)', () => {
		// Current implementation does NOT parse 'export' prefix — the key
		// would be 'export KEY' which is not what users might expect.
		// Documenting this behavior explicitly.
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, 'export EXPORTED_KEY=my-value\n');
		const provider = new FileSecretProvider(envPath);
		// "export EXPORTED_KEY" becomes the literal key name (with spaces trimmed to single space)
		expect(provider.getSecret('export EXPORTED_KEY')).toBe('my-value');
		// NOT available as EXPORTED_KEY
		expect(provider.getSecret('EXPORTED_KEY')).toBeNull();
	});

	test('Windows line endings (CRLF) are handled', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, 'KEY1=value1\r\nKEY2=value2\r\n');
		const provider = new FileSecretProvider(envPath);
		// trim() should handle the \r in split result
		expect(provider.getSecret('KEY1')).toBe('value1');
		expect(provider.getSecret('KEY2')).toBe('value2');
	});

	test('partially quoted value (mismatched quotes) preserves quotes as-is', () => {
		// Current contract: only strips quotes if BOTH start AND end match
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, 'PARTIAL="unclosed\nMIXED="double\'single"\n');
		const provider = new FileSecretProvider(envPath);
		// '"unclosed' — starts with " but doesn't end with ", so no stripping
		expect(provider.getSecret('PARTIAL')).toBe('"unclosed');
		// '"double\'single"' — starts and ends with " (but has single quote inside)
		// Strips outer double quotes: 'double\'single'
		expect(provider.getSecret('MIXED')).toBe("double'single");
	});

	test('value with only spaces is preserved as empty after trim', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, 'SPACE_KEY=   \n');
		const provider = new FileSecretProvider(envPath);
		// trim() removes all spaces → empty string
		expect(provider.getSecret('SPACE_KEY')).toBe('');
	});

	test('multiple config keys are all accessible', () => {
		const envPath = path.join(tmpDir, '.env');
		fs.writeFileSync(envPath, 'DB_HOST=localhost\nDB_PORT=5432\nDB_NAME=mydb\n');
		const provider = new FileSecretProvider(envPath);
		expect(provider.getSecret('DB_HOST')).toBe('localhost');
		expect(provider.getSecret('DB_PORT')).toBe('5432');
		expect(provider.getSecret('DB_NAME')).toBe('mydb');
	});
});
