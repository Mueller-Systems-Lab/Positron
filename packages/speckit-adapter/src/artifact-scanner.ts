// Positron — SpecKit Artifact Scanner

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SpecKitArtifactRef } from '@positron/shared';

/**
 * Durchsucht den Workspace nach Spec Kit Artefakten.
 * Erkennt spec.md, plan.md, tasks.md, research.md usw.
 */
export function scanWorkspace(workspacePath: string): SpecKitArtifactRef[] {
	const artifacts: SpecKitArtifactRef[] = [];

	if (!fs.existsSync(workspacePath)) {
		return artifacts;
	}

	// Bekannte Artefakt-Pfade
	const knownPaths: Array<{ kind: SpecKitArtifactRef['kind']; paths: string[] }> = [
		{
			kind: 'constitution',
			paths: ['.specify/memory/constitution.md', 'CONSTITUTION.md', 'constitution.md'],
		},
		{ kind: 'spec', paths: ['spec.md', 'specs/SPEC.md', 'specification.md', '.specify/spec.md', '.positron/artifacts/specify.md', '.positron/artifacts/speckit.specify.md'] },
		{ kind: 'plan', paths: ['plan.md', 'PLAN.md', '.specify/plan.md', '.positron/artifacts/plan.md', '.positron/artifacts/speckit.plan.md'] },
		{ kind: 'tasks', paths: ['tasks.md', 'TASKS.md', '.specify/tasks.md', '.positron/artifacts/tasks.md', '.positron/artifacts/speckit.tasks.md'] },
		{ kind: 'research', paths: ['research.md', 'RESEARCH.md', '.specify/research.md'] },
		{ kind: 'checklist', paths: ['checklist.md', '.specify/checklist.md'] },
	];

	for (const entry of knownPaths) {
		for (const p of entry.paths) {
			const fullPath = path.join(workspacePath, p);
			const exists = fs.existsSync(fullPath);
			artifacts.push({
				kind: entry.kind,
				path: p,
				exists,
				sha256: exists ? computeSha256(fullPath) : undefined,
			});
		}
	}

	return artifacts;
}

/**
 * Prüft ob ein Pfad innerhalb des Workspace sicher ist.
 * Verhindert directory traversal.
 */
export function isPathSafe(basePath: string, targetPath: string): boolean {
	const resolved = path.resolve(basePath, targetPath);
	return resolved.startsWith(path.resolve(basePath));
}

/**
 * Berechnet den SHA-256 Hash einer Datei.
 */
export function computeSha256(filePath: string): string {
	const content = fs.readFileSync(filePath);
	return crypto.createHash('sha256').update(content).digest('hex');
}
