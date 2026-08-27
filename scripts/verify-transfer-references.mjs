#!/usr/bin/env node

/**
 * Transfer regression guard for current-facing files.
 *
 * This is intentionally an allowlist, not a repository-wide ban: archived
 * evidence, changelogs, release records, and historical fixtures may truthfully
 * retain the former owner.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const oldReferences = [
	/github\.com\/xxammaxx\/Positron/i,
	/git@github\.com:xxammaxx\/Positron/i,
	/xxammaxx\.github\.io\/Positron/i,
];

const excluded = [
	'scripts/verify-transfer-references.mjs',
	'packages/shared/src/__tests__/github-snapshot-collector.test.ts',
];

const isCurrentPath = (file) =>
	file === 'README.md' ||
	file === 'CONTRIBUTING.md' ||
	file === 'SECURITY.md' ||
	file === 'AGENTS.md' ||
	file === '.env.example' ||
	file.startsWith('.github/') ||
	file.startsWith('.opencode/') ||
	file.startsWith('site/') ||
	file.startsWith('scripts/') ||
	file.startsWith('apps/') ||
	file.startsWith('packages/') ||
	file.startsWith('e2e/') ||
	file.startsWith('docs/install/') ||
	file.startsWith('docs/getting-started/') ||
	file.startsWith('docs/status/') ||
	file.startsWith('docs/governance/') ||
	file.startsWith('docs/security/') ||
	file.startsWith('docs/configuration/') ||
	file.startsWith('docs/architecture/');

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
	.split('\0')
	.filter((file) => file && isCurrentPath(file) && !excluded.includes(file));

const failures = [];
for (const file of files) {
	const content = fs.readFileSync(file, 'utf8');
	if (content.includes('\0')) continue;
	const lines = content.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		if (oldReferences.some((pattern) => pattern.test(lines[index]))) {
			failures.push(`${file}:${index + 1}:${lines[index].trim()}`);
		}
	}
}

if (failures.length > 0) {
	console.error('TRANSFER_REFERENCE_REGRESSION=FAIL');
	for (const failure of failures) console.error(failure);
	process.exit(1);
}

console.log(`TRANSFER_REFERENCE_REGRESSION=PASS (${files.length} current-facing files scanned)`);
console.log('CURRENT_STALE_OLD_OWNER_REFS=0');
console.log('CURRENT_STALE_OLD_PAGES_REFS=0');
