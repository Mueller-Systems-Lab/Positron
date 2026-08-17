// Positron Control Plane — Vertical Slice Test Helpers
//
// Echte fachliche Wirkung: temporärer Git-Workspace mit einer kleinen
// Funktion, kontrolliert rotem Test, deterministischem Build-Worker
// (LLM-Stellvertreter mit echten Dateiänderungen) und echtem TestRunner.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import { TestCommandDetector, TestRunner } from '@positron/sandbox';
import { applyControlPlaneMigrations } from '../schema.js';
import { classifyFailure } from '../failure.js';
import type { BuildResultContract, VerificationContract } from '../contracts.js';
import type { BuildWorker, VerificationTool } from '../durable-run.js';

export const BROKEN_SUM = `
// sum.js — fehlerhafte Implementierung (subtrahiert statt addiert)
function add(a, b) {
	return a - b;
}
module.exports = { add };
`;

export const CORRECT_SUM = `
// sum.js — korrekte Implementierung
function add(a, b) {
	return a + b;
}
module.exports = { add };
`;

export const SUM_TEST = `
const { test } = require('node:test');
const assert = require('node:assert');
const { add } = require('../src/sum.js');

test('add(2, 3) returns 5', () => {
	assert.strictEqual(add(2, 3), 5);
});

test('add(0, 0) returns 0', () => {
	assert.strictEqual(add(0, 0), 0);
});
`;

const PACKAGE_JSON = `
{
	"name": "vertical-slice-workspace",
	"private": true,
	"scripts": {
		"test": "node --test"
	}
}
`;

export interface TestWorkspace {
	dir: string;
	head: string;
	readHead: () => string;
}

/**
 * Erstellt einen echten, git-initialisierten Workspace mit
 * package.json (node --test), src/sum.js und test/sum.test.js.
 */
export function createTestWorkspace(initialSum: string = BROKEN_SUM): TestWorkspace {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-vslice-'));
	fs.mkdirSync(path.join(dir, 'src'));
	fs.mkdirSync(path.join(dir, 'test'));
	fs.writeFileSync(path.join(dir, 'package.json'), PACKAGE_JSON.trim() + '\n');
	fs.writeFileSync(path.join(dir, 'src', 'sum.js'), initialSum.trim() + '\n');
	fs.writeFileSync(path.join(dir, 'test', 'sum.test.js'), SUM_TEST.trim() + '\n');

	runGit(dir, ['init', '-q']);
	runGit(dir, ['config', 'user.email', 'positron@test.local']);
	runGit(dir, ['config', 'user.name', 'Positron Test']);
	runGit(dir, ['add', '.']);
	runGit(dir, ['commit', '-q', '-m', 'initial state (failing test)']);

	const readHead = (): string => runGit(dir, ['rev-parse', 'HEAD']).trim();
	return { dir, head: readHead(), readHead };
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

export function readFile(workspace: TestWorkspace, rel: string): string {
	return fs.readFileSync(path.join(workspace.dir, rel), 'utf-8');
}

export function cleanupWorkspace(workspace: TestWorkspace): void {
	fs.rmSync(workspace.dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Deterministischer Build-Worker (LLM-Stellvertreter mit echten Änderungen)
// ---------------------------------------------------------------------------

export type SumImplementation = 'broken' | 'correct' | 'multiply';

const IMPLEMENTATIONS: Record<SumImplementation, string> = {
	broken: BROKEN_SUM,
	correct: CORRECT_SUM,
	multiply: `
// sum.js — falsche Implementierung (multipliziert)
function add(a, b) {
	return a * b;
}
module.exports = { add };
`,
};

/**
 * Scripted Build Worker: wendet Implementierungen der Reihe nach auf die
 * echte Datei an. Zählt Aufrufe (Canary: kein zweiter LLM-Call).
 */
export class ScriptedBuildWorker implements BuildWorker {
	workerType = 'scripted-worker';
	provider: string | null = 'deterministic';
	model: string | null = 'vslice-1';
	invocations = 0;
	lastStrategyDelta: string | null = null;

	constructor(
		private readonly workspace: TestWorkspace,
		private readonly script: SumImplementation[],
	) {}

	async implement(input: {
		run_id: string;
		job_id: string;
		attempt_id: string;
		strategyDelta?: string | null;
	}): Promise<BuildResultContract> {
		this.invocations++;
		this.lastStrategyDelta = input.strategyDelta ?? null;
		const impl = this.script[this.invocations - 1] ?? this.script[this.script.length - 1]!;
		fs.writeFileSync(
			path.join(this.workspace.dir, 'src', 'sum.js'),
			IMPLEMENTATIONS[impl].trim() + '\n',
		);
		const changed = `src/sum.js (implementation=${impl})`;
		return {
			contract: 'positron.build-result.v1',
			run_id: input.run_id,
			job_id: input.job_id,
			attempt_id: input.attempt_id,
			status: 'success',
			summary: `Applied implementation ${impl}`,
			changed_files: [changed],
			result_ref: `file:${changed}`,
		};
	}
}

// ---------------------------------------------------------------------------
// Echte Verify-Tools (TestCommandDetector + TestRunner aus @positron/sandbox)
// ---------------------------------------------------------------------------

export function makeNodeTestVerifyTool(workspace: TestWorkspace): VerificationTool {
	const detector = new TestCommandDetector();
	const runner = new TestRunner();

	return {
		async run(ctx) {
			const detection = await detector.detect(workspace.dir);
			const start = Date.now();
			const report = await runner.runDetectedCommands({
				runId: ctx.run_id,
				workspacePath: workspace.dir,
				commands: detection.commands,
				mode: 'standard',
			});
			const durationMs = Date.now() - start;

			const check = {
				name: `npm test (${detection.framework ?? 'unknown'})`,
				passed: report.status === 'passed',
				kind: 'unit' as const,
				duration_ms: durationMs,
				detail: report.summary,
			};

			if (check.passed) {
				return { checks: [check] };
			}

			// Echte Evidenz aus dem Test-Output (keine LLM-Bewertung)
			const output = (report.details ?? [])
				.map((d) => `${d.stdout}\n${d.stderr}`)
				.join('\n')
				.slice(0, 2000);
			const classified = classifyFailure({
				stderr: output,
				exitCode: report.failed > 0 ? 1 : 0,
			});
			const newEvidence = `test output: ${output.slice(0, 400)}`;
			return {
				checks: [
					{
						name: check.name,
						passed: false,
						kind: 'unit',
						duration_ms: durationMs,
						detail: `${report.summary}; ${classified.signature}`,
					},
				],
				new_evidence: newEvidence,
			};
		},
	};
}

// ---------------------------------------------------------------------------
// In-Memory DB Helper
// ---------------------------------------------------------------------------

export function createTestDb(): Database.Database {
	const db = new DatabaseConstructor(':memory:');
	applyControlPlaneMigrations(db);
	return db;
}

export function verifyContractOf(attempts: Array<{ output_json: string | null }>): VerificationContract | null {
	for (const a of attempts) {
		if (a.output_json) {
			try {
				return JSON.parse(a.output_json) as VerificationContract;
			} catch {
				/* skip */
			}
		}
	}
	return null;
}
