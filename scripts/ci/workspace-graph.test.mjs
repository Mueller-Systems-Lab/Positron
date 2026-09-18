import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function workspaceDirectories() {
	const directories = [];
	for (const root of ['apps', 'packages']) {
		const rootPath = path.join(repoRoot, root);
		for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
			if (entry.isDirectory() && fs.existsSync(path.join(rootPath, entry.name, 'package.json'))) {
				directories.push(path.join(rootPath, entry.name));
			}
		}
	}
	return directories;
}

const workspaces = workspaceDirectories().map((directory) => ({
	directory,
	manifest: JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')),
}));
const byName = new Map(workspaces.map((workspace) => [workspace.manifest.name, workspace]));

function sourceFiles(directory) {
	const files = [];
	function visit(current) {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			if (entry.name === 'dist' || entry.name === 'node_modules') continue;
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) visit(absolute);
			else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) files.push(absolute);
		}
	}
	const sourceRoot = path.join(directory, 'src');
	if (fs.existsSync(sourceRoot)) visit(sourceRoot);
	return files;
}

function importedWorkspaceNames(source) {
	const names = new Set();
	const pattern = /(?:from\s+|import\s*\(\s*)['"](@positron\/[^'"]+)['"]/g;
	for (const match of source.matchAll(pattern)) names.add(match[1]);
	return names;
}

function tsReferenceDirectories(workspace) {
	const tsconfigPath = path.join(workspace.directory, 'tsconfig.json');
	if (!fs.existsSync(tsconfigPath)) return new Set();
	const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
	return new Set(
		(tsconfig.references ?? []).map((reference) =>
			path.resolve(workspace.directory, reference.path),
		),
	);
}

function requiresTypeScriptReferences(workspace) {
	const tsconfigPath = path.join(workspace.directory, 'tsconfig.json');
	if (!fs.existsSync(tsconfigPath)) return false;
	const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
	return tsconfig.compilerOptions?.moduleResolution !== 'bundler';
}

test('workspace production imports are declared and directly referenced', () => {
	const violations = [];
	for (const workspace of workspaces) {
		for (const file of sourceFiles(workspace.directory)) {
			const relative = path.relative(workspace.directory, file);
			const isTest = /(?:^|[\\/])__tests__(?:[\\/]|$)|\.(?:test|spec)\./.test(relative);
			if (isTest) continue;
			const source = fs.readFileSync(file, 'utf8');
			for (const name of importedWorkspaceNames(source)) {
				const dependency = byName.get(name);
				if (!dependency) {
					violations.push(`${workspace.manifest.name} ${relative}: unknown workspace ${name}`);
					continue;
				}
				const declared = workspace.manifest.dependencies?.[name];
				if (!declared) {
					violations.push(`${workspace.manifest.name} ${relative}: ${name} is not in dependencies`);
				}
				if (
					requiresTypeScriptReferences(workspace) &&
					!tsReferenceDirectories(workspace).has(dependency.directory)
				) {
					violations.push(
						`${workspace.manifest.name} ${relative}: ${name} is not a direct tsconfig reference`,
					);
				}
			}
		}
	}
	assert.deepEqual(violations, [], violations.join('\n'));
});

test('root build explicitly includes every runtime project boundary', () => {
	const build = rootPackage.scripts?.build ?? '';
	const required = [
		'packages/control-plane',
		'packages/worker-pipeline',
		'apps/server',
		'apps/worker',
	];
	const missing = required.filter((project) => !build.includes(project));
	assert.deepEqual(missing, [], `root build is missing: ${missing.join(', ')}`);
});

test('clean removes dist and TypeScript incremental products', () => {
	const clean = rootPackage.scripts?.clean ?? '';
	assert.match(clean, /-name dist/);
	assert.match(clean, /tsbuildinfo/);
});
