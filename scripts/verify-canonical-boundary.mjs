import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
	'PRODUCT_CONTRACT.md',
	'MIGRATION_MANIFEST.md',
	'docs/architecture/system.mmd',
	'docs/migration/manifest.json',
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
	console.error(`Missing canonical contract files: ${missing.join(', ')}`);
	process.exit(1);
}

const contract = fs.readFileSync(path.join(root, 'PRODUCT_CONTRACT.md'), 'utf8');
for (const invariant of [
	'POSITRON MAY NOT BECOME MORPHEUS',
	'credential_ref',
	'single lifecycle authority',
]) {
	if (!contract.includes(invariant)) {
		console.error(`Missing product invariant: ${invariant}`);
		process.exit(1);
	}
}

const forbiddenControllerImports = [];
for (const directory of ['apps/server/src', 'packages/control-plane/src']) {
	const stack = [path.join(root, directory)];
	while (stack.length) {
		const current = stack.pop();
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
				const source = fs.readFileSync(full, 'utf8');
				if (/from ['"].*morpheus.*['"]|import\(['"].*morpheus.*['"]\)/i.test(source))
					forbiddenControllerImports.push(path.relative(root, full));
			}
		}
	}
}
if (forbiddenControllerImports.length) {
	console.error(
		`Morpheus controller imports are forbidden: ${forbiddenControllerImports.join(', ')}`,
	);
	process.exit(1);
}
console.log('canonical-boundary: PASS');
