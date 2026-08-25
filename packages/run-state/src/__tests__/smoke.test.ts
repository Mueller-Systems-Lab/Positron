// Positron — Run State Package: Smoke-Tests

import type { Phase } from '@positron/shared';
import { describe, expect, test } from 'vitest';
import type { RunEventData } from '../state-machine.js';
import { canTransition, createRun, isTerminalPhase, resumeFromEvents } from '../state-machine.js';

describe('createRun', () => {
	test('erstellt einen validen RunState', () => {
		const run = createRun('repo-1', 42, 2);
		expect(run).toBeDefined();
		expect(run.repoId).toBe('repo-1');
		expect(run.issueNumber).toBe(42);
		expect(run.autonomyLevel).toBe(2);
		expect(run.phase).toBe('QUEUED');
		expect(run.status).toBe('active');
		expect(run.attempt).toBe(1);
	});

	test('generiert eine eindeutige ID', () => {
		const run1 = createRun('repo-1', 1, 2);
		const run2 = createRun('repo-1', 1, 2);
		expect(run1.id).not.toBe(run2.id);
	});
});

describe('canTransition', () => {
	test('QUEUED → CLAIMED ist gültig', () => {
		expect(canTransition('QUEUED', 'CLAIMED')).toBe(true);
	});

	test('DONE → QUEUED ist ungültig', () => {
		expect(canTransition('DONE', 'QUEUED')).toBe(false);
	});

	test('TEST → VERIFY ist gültig', () => {
		expect(canTransition('TEST', 'VERIFY')).toBe(true);
	});

	test('TEST → IMPLEMENT ist gültig (Fix-Loop)', () => {
		expect(canTransition('TEST', 'IMPLEMENT')).toBe(true);
	});

	test('FAILED_BLOCKED → QUEUED ist ungültig', () => {
		expect(canTransition('FAILED_BLOCKED', 'QUEUED')).toBe(false);
	});
});

describe('isTerminalPhase', () => {
	test('DONE ist terminal', () => {
		expect(isTerminalPhase('DONE')).toBe(true);
	});

	test('QUEUED ist nicht terminal', () => {
		expect(isTerminalPhase('QUEUED')).toBe(false);
	});

	test('FAILED_BLOCKED ist terminal', () => {
		expect(isTerminalPhase('FAILED_BLOCKED')).toBe(true);
	});
});

describe('resumeFromEvents', () => {
	test('setzt korrekt aus Events fort', () => {
		const events: RunEventData[] = [
			{
				id: 'e1',
				runId: 'run-1',
				phase: 'CLAIMED',
				level: 'INFO',
				message: 'claimed',
				payload: null,
				createdAt: new Date().toISOString(),
			},
			{
				id: 'e2',
				runId: 'run-1',
				phase: 'REPO_SYNC',
				level: 'INFO',
				message: 'synced',
				payload: null,
				createdAt: new Date().toISOString(),
			},
			{
				id: 'e3',
				runId: 'run-1',
				phase: 'SPECIFY',
				level: 'INFO',
				message: 'spec done',
				payload: null,
				createdAt: new Date().toISOString(),
			},
		];

		const result = resumeFromEvents('run-1', 'repo-1', 42, events);

		// Die letzte abgeschlossene Phase ist SPECIFY, also sollte resumeFromEvents SPECIFY zurückgeben
		expect(result.phase).toBe('SPECIFY');
		expect(result.repoId).toBe('repo-1');
		expect(result.issueNumber).toBe(42);
	});
});
