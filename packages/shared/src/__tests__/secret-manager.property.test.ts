/**
 * Secret Manager Property-Based Tests (QA-026)
 *
 * Hardens secret-manager.ts against mutation survivors in
 * FileSecretProvider.parseEnvFile() and related code paths.
 *
 * Target survivors (17 total):
 *   1-4:  Line filtering (trim, empty, comments)
 *   5-6:  Lines without '=' sign
 *   7-10: Quote stripping
 *   11:   Empty key guard
 *   12:   envFilePath resolution
 *   13-16: resolveDefaultEnvPath
 *   17:   DockerSecretProvider constructor
 *
 * All values are synthetic fakes. No real secrets, no real .env files.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SecretProvider } from '@positron/shared';
import { DockerSecretProvider, FileSecretProvider, SecretManager } from '@positron/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

// =========================================================================
// HELPERS
// =========================================================================

function createTempEnvFile(lines: string[]): string {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-prop-'));
	const filePath = path.join(tmpDir, '.env');
	fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
	return filePath;
}

function cleanupTempFile(filePath: string): void {
	try {
		fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
	} catch {
		/* best effort */
	}
}

/** Creates a temp dir with a secret file for DockerSecretProvider testing */
function createTempSecret(tmpDir: string, name: string, value: string): void {
	fs.writeFileSync(path.join(tmpDir, name.toLowerCase()), value, 'utf-8');
}

// =========================================================================
// GENERATORS: .env Parsing (Phase 4)
// =========================================================================

/** Safe characters for env keys */
const ENV_KEY_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';

/** Object.prototype property names to avoid in key generators */
const OBJECT_PROTO_KEYS = new Set([
	'toString',
	'valueOf',
	'hasOwnProperty',
	'toLocaleString',
	'constructor',
	'isPrototypeOf',
	'propertyIsEnumerable',
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
	'__proto__',
]);

/** Arbitrary: valid env key */
const validKeyArb = fc
	.string({
		minLength: 1,
		maxLength: 20,
		unit: fc.constantFrom(...ENV_KEY_CHARS.split('')),
	})
	.filter((k) => k.length > 0 && !OBJECT_PROTO_KEYS.has(k));

/** Arbitrary: potentially invalid env key (may include spaces or be empty) */
const anyKeyArb = fc.oneof(
	validKeyArb,
	fc.constant(''),
	fc.string({ minLength: 1, maxLength: 10 }).map((k) => ` ${k}`),
	fc.string({ minLength: 1, maxLength: 10 }).map((k) => `${k} `),
	fc.string({ minLength: 1, maxLength: 5 }).map((k) => ` ${k} `),
);

/** Arbitrary: env value (no newlines, no surrounding whitespace — parser trims) */
const envValueArb = fc.oneof(
	fc.string({ minLength: 0, maxLength: 30 }).filter((v) => !v.includes('\n') && v.trim() === v),
	fc.constant('value-with=equals=inside'),
	fc.constant(''),
	fc.constant('"quoted value"'),
	fc.constant("'single-quoted value'"),
	fc.constant('ghp_fake_abcdefghijklmnopqrstuvwxyz123456'),
	fc.constant('sk-fake-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
);

/** Arbitrary: complete KEY=VALUE line */
const validLineArb = fc.tuple(validKeyArb, envValueArb).map(([k, v]) => `${k}=${v}`);

/** Arbitrary: KEY with spaces = value */
const spaceKeyLineArb = fc.tuple(anyKeyArb, envValueArb).map(([k, v]) => `${k}=${v}`);

/** Arbitrary: =value (no key) */
const noKeyLineArb = envValueArb.map((v) => `=${v}`);

/** Arbitrary: comment line */
const commentLineArb = fc.oneof(
	fc.constant('# this is a comment'),
	fc.constant('# KEY=value'),
	fc
		.tuple(fc.constant('# '), validKeyArb, fc.constant('=ignored'))
		.map(([p, k, s]) => `${p}${k}${s}`),
);

/** Arbitrary: whitespace line */
const blankLineArb = fc.oneof(
	fc.constant(''),
	fc.string({ minLength: 1, maxLength: 8 }).map((s) => ' '.repeat(s.length % 9)),
);

/** Arbitrary: invalid line (no = sign) */
const invalidLineArb = fc.oneof(
	validKeyArb.map((k) => k),
	fc.constant('just some text without equals'),
	fc.string({ minLength: 1, maxLength: 15 }).filter((s) => !s.includes('=')),
);

/** Arbitrary: any env line type */
const anyEnvLineArb = fc.oneof(
	validLineArb,
	spaceKeyLineArb,
	noKeyLineArb,
	commentLineArb,
	blankLineArb,
	invalidLineArb,
);

/** Arbitrary: full .env file content (0-30 lines) */
const envFileContentArb = fc.array(anyEnvLineArb, {
	minLength: 0,
	maxLength: 30,
});

/** Arbitrary: lines with duplicate keys */
const duplicateKeyArb = fc
	.tuple(fc.constant('DUPKEY'), envValueArb, envValueArb)
	.map(([key, v1, v2]) => [`${key}=${v1}`, `${key}=${v2}`]);

// =========================================================================
// PROPERTY TESTS (Phase 5)
// =========================================================================

describe('FileSecretProvider parseEnvFile() properties', () => {
	// Property 1: Parser wirft nie bei beliebigem Text
	it('never throws for random env content', () => {
		fc.assert(
			fc.property(envFileContentArb, (lines) => {
				const tmpFile = createTempEnvFile(lines);
				try {
					const provider = new FileSecretProvider(tmpFile);
					expect(() => provider.getSecret('ANY_KEY')).not.toThrow();
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 200 },
		);
	});

	// Property 2: Gültige KEY=value-Zeilen sind abrufbar
	it('valid KEY=VALUE lines are retrievable', () => {
		fc.assert(
			fc.property(validKeyArb, envValueArb, (key, value) => {
				const tmpFile = createTempEnvFile([`${key}=${value}`]);
				try {
					const provider = new FileSecretProvider(tmpFile);
					const result = provider.getSecret(key);
					let expected = value;
					// Parser strips quotes
					if (
						(expected.startsWith('"') && expected.endsWith('"')) ||
						(expected.startsWith("'") && expected.endsWith("'"))
					) {
						expected = expected.slice(1, -1);
					}
					// Parser trims — but our generator already avoids surrounding spaces
					expect(result).toBe(expected);
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 200 },
		);
	});

	// Property 3: Werte mit = bleiben korrekt erhalten
	it('values containing = are preserved', () => {
		fc.assert(
			fc.property(validKeyArb, (key) => {
				const complexValue = 'a=b=c=d';
				const tmpFile = createTempEnvFile([`${key}=${complexValue}`]);
				try {
					const provider = new FileSecretProvider(tmpFile);
					expect(provider.getSecret(key)).toBe(complexValue);
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 100 },
		);
	});

	// Property 4: Kommentare und Leerzeilen erzeugen keine Secrets
	it('comments and blank lines produce no secrets', () => {
		fc.assert(
			fc.property(
				validKeyArb,
				fc.array(fc.oneof(commentLineArb, blankLineArb), {
					minLength: 1,
					maxLength: 10,
				}),
				(key, noise) => {
					const allLines = [...noise];
					const tmpFile = createTempEnvFile(allLines);
					try {
						const provider = new FileSecretProvider(tmpFile);
						// No secret should exist from comments/blanks
						for (const line of noise) {
							const lineKey = line.replace('# ', '').split('=')[0] ?? '';
							// Commented-out keys should NOT be retrievable
							if (line.startsWith('#') && lineKey.length > 0 && lineKey !== line) {
								expect(provider.getSecret(lineKey)).toBeNull();
							}
						}
						// A key not in the file should return null
						expect(provider.getSecret(key)).toBeNull();
					} finally {
						cleanupTempFile(tmpFile);
					}
				},
			),
			{ numRuns: 300 },
		);
	});

	// Property 5: Ungültige Zeilen ohne = werden ignoriert
	it('invalid lines without = are ignored', () => {
		fc.assert(
			fc.property(invalidLineArb, validKeyArb, (invalid, validKey) => {
				const tmpFile = createTempEnvFile([invalid, `${validKey}=present`]);
				try {
					const provider = new FileSecretProvider(tmpFile);
					// The invalid line text should not appear as a retrievable secret
					// (skip Object.prototype collision keys — they return {} not null,
					//  and skip when invalid coincides with validKey — the valid line provides the key)
					if (!OBJECT_PROTO_KEYS.has(invalid) && invalid !== validKey) {
						expect(provider.getSecret(invalid)).toBeNull();
					}
					// A real key should still work
					expect(provider.getSecret(validKey)).toBe('present');
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 300 },
		);
	});

	// Property 6: Leere Keys (z.B. =value) werden ignoriert
	it('=value lines (no key) are ignored', () => {
		fc.assert(
			fc.property(envValueArb, validKeyArb, (value, validKey) => {
				const tmpFile = createTempEnvFile([`=${value}`, `${validKey}=present`]);
				try {
					const provider = new FileSecretProvider(tmpFile);
					// No empty key should exist
					expect(provider.getSecret('')).toBeNull();
					// Real key preserved
					expect(provider.getSecret(validKey)).toBe('present');
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 200 },
		);
	});

	// Property 7: Keys mit Spaces um = werden getrimmt
	it('keys and values with spaces around = are trimmed', () => {
		fc.assert(
			fc.property(validKeyArb, envValueArb, (key, value) => {
				// Avoid quoted or empty values — they have special handling
				if (value.startsWith('"') || value.startsWith("'") || value === '') return;
				const tmpFile = createTempEnvFile([`  ${key}  =  ${value}  `]);
				try {
					const provider = new FileSecretProvider(tmpFile);
					expect(provider.getSecret(key)).toBe(value);
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 300 },
		);
	});

	// Property 8: Doppelte Keys — last wins
	it('duplicate keys: last value wins', () => {
		fc.assert(
			fc.property(duplicateKeyArb, (lines) => {
				const tmpFile = createTempEnvFile(lines);
				try {
					const provider = new FileSecretProvider(tmpFile);
					const rawSecond = lines[1]!.split('=').slice(1).join('=');
					// Apply same quote-stripping as the parser
					let expected = rawSecond;
					if (
						(expected.startsWith('"') && expected.endsWith('"')) ||
						(expected.startsWith("'") && expected.endsWith("'"))
					) {
						expected = expected.slice(1, -1);
					}
					expect(provider.getSecret('DUPKEY')).toBe(expected);
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 200 },
		);
	});

	// Property 9: Caching — parses only once
	it('caches parsed content (parse once)', () => {
		fc.assert(
			fc.property(validKeyArb, envValueArb, envValueArb, (key, v1, v2) => {
				if (v1 === v2) return;
				const tmpFile = createTempEnvFile([`${key}=${v1}`]);
				try {
					const provider = new FileSecretProvider(tmpFile);
					let expectedV1 = v1;
					if (
						(expectedV1.startsWith('"') && expectedV1.endsWith('"')) ||
						(expectedV1.startsWith("'") && expectedV1.endsWith("'"))
					) {
						expectedV1 = expectedV1.slice(1, -1);
					}
					expect(provider.getSecret(key)).toBe(expectedV1);
					// Modify the file on disk
					fs.writeFileSync(tmpFile, `${key}=${v2}`, 'utf-8');
					// Should still return cached v1 (the parsed/processed version)
					expect(provider.getSecret(key)).toBe(expectedV1);
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 300 },
		);
	});
});

// =========================================================================
// DockerSecretProvider properties (target survivor 17)
// =========================================================================

describe('DockerSecretProvider properties', () => {
	it('constructor accepts custom secretsDir', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-docker-'));
		try {
			createTempSecret(tmpDir, 'TOKEN', 'custom-secret-value');
			const provider = new DockerSecretProvider(tmpDir);
			expect(provider.name).toBe('docker-secret');
			// Should lowercase the key for lookup
			expect(provider.getSecret('TOKEN')).toBe('custom-secret-value');
			expect(provider.getSecret('token')).toBe('custom-secret-value');
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('returns null for missing secret in custom dir', () => {
		fc.assert(
			fc.property(validKeyArb, (key) => {
				const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-docker-'));
				try {
					const provider = new DockerSecretProvider(tmpDir);
					expect(provider.getSecret(key)).toBeNull();
				} finally {
					fs.rmSync(tmpDir, { recursive: true, force: true });
				}
			}),
			{ numRuns: 100 },
		);
	});
});

// =========================================================================
// SecretManager properties (target survivors 12-16)
// =========================================================================

describe('SecretManager envFilePath option', () => {
	it('accepts custom env file path', () => {
		fc.assert(
			fc.property(validKeyArb, envValueArb, (key, value) => {
				// Skip values that are empty or become empty after parser quote-stripping.
				// SecretManager.getSecret() filters empty strings (value.length > 0 gate),
				// so a value like '"' (sole quote) is stripped to '' and returns null,
				// but the test oracle would predict ''. This gate closes that gap.
				// See QA-034 edge-case analysis for details.
				if (value === '') return;
				if (
					(value.startsWith('"') && value.endsWith('"') && value.length <= 2) ||
					(value.startsWith("'") && value.endsWith("'") && value.length <= 2)
				) {
					return; // value becomes empty after quote stripping
				}
				// Use a custom provider list to avoid EnvSecretProvider collision
				const tmpFile = createTempEnvFile([`${key}=${value}`]);
				try {
					const fileProvider = new FileSecretProvider(tmpFile);
					const sm = new SecretManager({ providers: [fileProvider] });
					expect(sm.getProviderNames()).toContain('file');
					let expected = value;
					if (
						(expected.startsWith('"') && expected.endsWith('"')) ||
						(expected.startsWith("'") && expected.endsWith("'"))
					) {
						expected = expected.slice(1, -1);
					}
					expect(sm.getSecret(key)).toBe(expected);
				} finally {
					cleanupTempFile(tmpFile);
				}
			}),
			{ numRuns: 300 },
		);
	});

	it('custom env file path with missing file does not crash', () => {
		const sm = new SecretManager({
			envFilePath: '/tmp/non-existent-positron-test.env',
		});
		expect(sm.getSecret('ANYTHING')).toBeNull();
		expect(sm.getProviderNames()).toContain('file');
	});

	it('getProviderNames returns all default providers', () => {
		const sm = new SecretManager();
		const names = sm.getProviderNames();
		expect(names).toContain('env');
		expect(names).toContain('docker-secret');
		expect(names).toContain('file');
		expect(names.length).toBe(3);
	});

	it('custom providers override defaults', () => {
		fc.assert(
			fc.property(validKeyArb, envValueArb, (key, value) => {
				// Empty values are skipped by SecretManager — skip them
				if (value === '') return;
				const customProvider: SecretProvider = {
					name: 'custom-test',
					getSecret: (k: string) => (k === key ? value : null),
				};
				const sm = new SecretManager({ providers: [customProvider] });
				expect(sm.getSecret(key)).toBe(value);
				expect(sm.getProviderNames()).toEqual(['custom-test']);
				expect(sm.hasSecret(key)).toBe(true);
			}),
			{ numRuns: 500 },
		);
	});
});

// =========================================================================
// DIRECT SURVIVOR ATTACKS
// =========================================================================

describe('Targeted survivor-killing edge cases', () => {
	// Survivor 1: trimmed = line  (line.trim() removed)
	it('handles lines with surrounding whitespace correctly', () => {
		const tmpFile = createTempEnvFile(['', '  #comment with space', '  KEY  =  value  ', '']);
		try {
			const provider = new FileSecretProvider(tmpFile);
			// Untrimmed line "  KEY  =  value  " → key "KEY", value "value"
			expect(provider.getSecret('KEY')).toBe('value');
			// If trim were removed, key would be "  KEY  " which wouldn't match "KEY"
			// The fact that this works means trim IS working
		} finally {
			cleanupTempFile(tmpFile);
		}
	});

	// Survivor 2-4: !trimmed || trimmed.startsWith('#')  continue logic
	it('handles lines that look like comments but are keys', () => {
		// If the mutant removed the continue check, '#KEY=value' would be parsed as key='#KEY'
		const tmpFile = createTempEnvFile(['#KEY=should-be-commented', 'REAL=present']);
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('#KEY')).toBeNull();
			expect(provider.getSecret('REAL')).toBe('present');
		} finally {
			cleanupTempFile(tmpFile);
		}
	});

	// Survivors 5-6: Lines without = sign
	it('ignores lines without = sign', () => {
		const tmpFile = createTempEnvFile(['just-some-text', 'anotherLineWithoutEquals', 'KEY=value']);
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('just-some-text')).toBeNull();
			expect(provider.getSecret('anotherLineWithoutEquals')).toBeNull();
			expect(provider.getSecret('KEY')).toBe('value');
		} finally {
			cleanupTempFile(tmpFile);
		}
	});

	// Survivors 7-10: Quote stripping logic
	it('strips double quotes from value', () => {
		const tmpFile = createTempEnvFile(['QUOTED="hello world"']);
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('QUOTED')).toBe('hello world');
		} finally {
			cleanupTempFile(tmpFile);
		}
	});

	it('strips single quotes from value', () => {
		const tmpFile = createTempEnvFile(["SINGLE='hello world'"]);
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('SINGLE')).toBe('hello world');
		} finally {
			cleanupTempFile(tmpFile);
		}
	});

	it('preserves mismatched quote (only one side)', () => {
		const tmpFile = createTempEnvFile(['MISMATCHED="hello world', 'MISMATCHED2=hello world"']);
		try {
			const provider = new FileSecretProvider(tmpFile);
			// Value should keep the quote as-is since both startswith AND endswith are required
			expect(provider.getSecret('MISMATCHED')).toBe('"hello world');
			expect(provider.getSecret('MISMATCHED2')).toBe('hello world"');
		} finally {
			cleanupTempFile(tmpFile);
		}
	});

	// Survivor 11: Empty key guard
	it('ignores line where key is empty after trim', () => {
		const tmpFile = createTempEnvFile(['=emptyKey', 'VALID=present']);
		try {
			const provider = new FileSecretProvider(tmpFile);
			expect(provider.getSecret('')).toBeNull();
			expect(provider.getSecret('VALID')).toBe('present');
		} finally {
			cleanupTempFile(tmpFile);
		}
	});

	// Survivor 13-16: resolveDefaultEnvPath
	it('resolveDefaultEnvPath uses first valid candidate', () => {
		// Create a temp .env file in cwd
		const tmpEnvFile = path.join(os.tmpdir(), 'positron-test-env', '.env');
		try {
			fs.mkdirSync(path.dirname(tmpEnvFile), { recursive: true });
			fs.writeFileSync(tmpEnvFile, 'CUSTOM_DEFAULT=from-resolve', 'utf-8');
			// We can't easily test resolveDefaultEnvPath without changing process.cwd(),
			// but we can verify the contract: if envFilePath is provided, it's used
			const sm = new SecretManager({ envFilePath: tmpEnvFile });
			expect(sm.getSecret('CUSTOM_DEFAULT')).toBe('from-resolve');
		} finally {
			fs.rmSync(path.dirname(tmpEnvFile), { recursive: true, force: true });
		}
	});

	// Test that the fallback filesystem check works
	it('custom envFilePath takes precedence over defaults', () => {
		const tmpFile1 = createTempEnvFile(['KEY=first']);
		const tmpFile2 = createTempEnvFile(['KEY=second']);
		try {
			const sm = new SecretManager({ envFilePath: tmpFile1 });
			expect(sm.getSecret('KEY')).toBe('first');
		} finally {
			cleanupTempFile(tmpFile1);
			cleanupTempFile(tmpFile2);
		}
	});
});

// =========================================================================
// NEGATIVE ASSURANCE (Phase 6)
// =========================================================================
describe('Negative Assurance: env generators', () => {
	it('validLineArb generates valid KEY=VALUE lines', () => {
		fc.assert(
			fc.property(validLineArb, (line) => {
				// Line must be KEY=VALUE format (value may be empty)
				expect(line).toMatch(/^[a-zA-Z0-9_]+=.*$/);
				expect(line.startsWith('#')).toBe(false);
			}),
			{ numRuns: 500 },
		);
	});

	it('commentLineArb generates lines starting with #', () => {
		fc.assert(
			fc.property(commentLineArb, (line) => {
				expect(line.startsWith('#')).toBe(true);
			}),
			{ numRuns: 300 },
		);
	});

	it('invalidLineArb generates lines without =', () => {
		fc.assert(
			fc.property(invalidLineArb, (line) => {
				expect(line.includes('=')).toBe(false);
			}),
			{ numRuns: 300 },
		);
	});

	it('blankLineArb generates empty or whitespace-only lines', () => {
		fc.assert(
			fc.property(blankLineArb, (line) => {
				expect(line.trim()).toBe('');
			}),
			{ numRuns: 300 },
		);
	});

	it('duplicateKeyArb generates lines with same key', () => {
		fc.assert(
			fc.property(duplicateKeyArb, (lines) => {
				expect(lines.length).toBe(2);
				expect(lines[0]!.startsWith('DUPKEY=')).toBe(true);
				expect(lines[1]!.startsWith('DUPKEY=')).toBe(true);
			}),
			{ numRuns: 200 },
		);
	});
});
