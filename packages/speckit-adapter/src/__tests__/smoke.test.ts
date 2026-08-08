// Positron — SpecKit Adapter: Smoke-Tests

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { computeSha256, isPathSafe, scanWorkspace } from '../artifact-scanner.js';
import {
	FAKE_HEALTH_AVAILABLE,
	FAKE_HEALTH_UNAVAILABLE,
	FakeSpecKitAdapter,
} from '../fake-adapter.js';

describe('FakeSpecKitAdapter', () => {
	test('healthCheck mit Standard-Health', async () => {
		const adapter = new FakeSpecKitAdapter();
		const health = await adapter.healthCheck('/tmp');
		expect(health.available).toBe(true);
		expect(health.version).toBe('0.1.0-fake');
	});

	test('healthCheck mit UNAVAILABLE', async () => {
		const adapter = new FakeSpecKitAdapter(FAKE_HEALTH_UNAVAILABLE);
		const health = await adapter.healthCheck('/tmp');
		expect(health.available).toBe(false);
	});

	test('initialize ruft Kommando-Log', async () => {
		const adapter = new FakeSpecKitAdapter();
		await adapter.initialize({ runId: 'test', workspacePath: '/tmp', issueTitle: 'test' });
		const log = adapter.getCommandCallLog();
		expect(log).toContain('initialize');
	});

	test('runSpecify in artifact-only mode', async () => {
		const adapter = new FakeSpecKitAdapter();
		const result = await adapter.runSpecify({
			runId: 'test',
			workspacePath: '/tmp',
			issueTitle: 'test',
			mode: 'artifact-only',
		});
		expect(result.status).toBe('skipped');
	});

	test('runSpecify in safe-cli mode', async () => {
		const adapter = new FakeSpecKitAdapter();
		const result = await adapter.runSpecify({
			runId: 'test',
			workspacePath: '/tmp',
			issueTitle: 'test',
			mode: 'safe-cli',
		});
		expect(result.status).toBe('blocked');
		expect(result.blockedReason).toContain('Agent Slash Command');
	});

	test('clearCallLog leert das Log', () => {
		const adapter = new FakeSpecKitAdapter();
		adapter.clearCallLog();
		expect(adapter.getCommandCallLog()).toHaveLength(0);
	});
});

describe('artifact-scanner', () => {
	test('scanWorkspace bei nicht-existierendem Pfad', () => {
		const results = scanWorkspace('/nonexistent/path');
		expect(results).toHaveLength(0);
	});

	test('isPathSafe erkennt sichere Pfade', () => {
		expect(isPathSafe('/base', 'file.txt')).toBe(true);
		expect(isPathSafe('/base', '/base/file.txt')).toBe(true);
	});

	test('isPathSafe erkennt unsichere Pfade', () => {
		expect(isPathSafe('/base', '../etc/passwd')).toBe(false);
	});

	// Regression test for Defect A: Artifact-Scanner muss .positron/artifacts/ Pfade erkennen.
	// RealOpenCodeAdapter speichert generierte Spec/Plan/Tasks-Artefakte in diesen Pfad.
	// Ohne diesen Test wäre der Real-Mode-Pfad broken (REVIEW findet keine Artifacts).
	test('scanWorkspace erkennt .positron/artifacts/specify.md als spec', () => {
		const tmp = fs.mkdtempSync('/tmp/positron-scanner-test-');
		try {
			const artifactsDir = `${tmp}/.positron/artifacts`;
			fs.mkdirSync(artifactsDir, { recursive: true });
			fs.writeFileSync(`${artifactsDir}/specify.md`, '# Spec: countVowels', 'utf-8');
			fs.writeFileSync(`${artifactsDir}/plan.md`, '# Plan', 'utf-8');
			fs.writeFileSync(`${artifactsDir}/tasks.md`, '# Tasks', 'utf-8');

			const results = scanWorkspace(tmp);

			// spec
			const specResult = results.find(
				(r) => r.kind === 'spec' && r.path === '.positron/artifacts/specify.md',
			);
			expect(specResult).toBeDefined();
			expect(specResult!.exists).toBe(true);

			// plan
			const planResult = results.find(
				(r) => r.kind === 'plan' && r.path === '.positron/artifacts/plan.md',
			);
			expect(planResult).toBeDefined();
			expect(planResult!.exists).toBe(true);

			// tasks
			const tasksResult = results.find(
				(r) => r.kind === 'tasks' && r.path === '.positron/artifacts/tasks.md',
			);
			expect(tasksResult).toBeDefined();
			expect(tasksResult!.exists).toBe(true);

			// Verify speckit.* variants (worker path compatibility)
			fs.writeFileSync(`${artifactsDir}/speckit.specify.md`, '# Worker spec', 'utf-8');
			const results2 = scanWorkspace(tmp);
			const workerSpecResult = results2.find(
				(r) => r.kind === 'spec' && r.path === '.positron/artifacts/speckit.specify.md',
			);
			expect(workerSpecResult).toBeDefined();
			expect(workerSpecResult!.exists).toBe(true);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
