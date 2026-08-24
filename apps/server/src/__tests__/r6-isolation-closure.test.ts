import { resolvePipelineQueueName } from '@positron/shared';
import {
	isFaultTargetedToRun,
	isRunInWorkerScope,
	isTerminalRunRecord,
} from '@positron/worker-pipeline';
import { describe, expect, it } from 'vitest';

describe('R6 isolation closure contract', () => {
	describe('run-scoped queue routing', () => {
		it('routes each scoped run to a distinct BullMQ queue', () => {
			expect(resolvePipelineQueueName('POS-NORTHSTAR-R6-A', true)).toBe(
				'positron-pipeline-POS-NORTHSTAR-R6-A',
			);
			expect(resolvePipelineQueueName('POS-NORTHSTAR-R6-B', true)).toBe(
				'positron-pipeline-POS-NORTHSTAR-R6-B',
			);
			expect(resolvePipelineQueueName('POS-NORTHSTAR-R6-A', true)).not.toBe(
				resolvePipelineQueueName('POS-NORTHSTAR-R6-B', true),
			);
		});

		it('rejects a scoped worker without a run identity', () => {
			expect(() => resolvePipelineQueueName(undefined, true)).toThrow(
				'run-scoped queue requires a run ID',
			);
		});

		it('keeps the default queue unchanged when scoping is disabled', () => {
			expect(resolvePipelineQueueName('run-a', false)).toBe('positron-pipeline');
		});
	});

	describe('run-scoped fault injection', () => {
		it('targets only the configured run ID or its issue identity', () => {
			expect(
				isFaultTargetedToRun('POS-NORTHSTAR-R6-A', {
					id: 'POS-NORTHSTAR-R6-A',
					issueNumber: 13,
				}),
			).toBe(true);
			expect(
				isFaultTargetedToRun('13', {
					id: 'generated-run-a',
					issueNumber: 13,
				}),
			).toBe(true);
			expect(
				isFaultTargetedToRun('POS-NORTHSTAR-R6-A', {
					id: 'POS-NORTHSTAR-R6-B',
					issueNumber: 14,
				}),
			).toBe(false);
		});

		it('does not activate a fault without an explicit target', () => {
			expect(isFaultTargetedToRun(undefined, { id: 'run-a', issueNumber: 13 })).toBe(false);
		});
	});

	describe('worker job scoping', () => {
		it('rejects a job routed to the wrong worker scope', () => {
			expect(isRunInWorkerScope('POS-NORTHSTAR-R6-A', 'POS-NORTHSTAR-R6-A')).toBe(true);
			expect(isRunInWorkerScope('POS-NORTHSTAR-R6-A', 'POS-NORTHSTAR-R6-B')).toBe(false);
			expect(isRunInWorkerScope(undefined, 'POS-NORTHSTAR-R6-B')).toBe(true);
		});
	});

	describe('stale terminal jobs', () => {
		it('recognizes completed and finished database records as terminal', () => {
			expect(isTerminalRunRecord({ phase: 'DONE', finishedAt: null })).toBe(true);
			expect(isTerminalRunRecord({ phase: 'PR_CREATE', finishedAt: '2026-08-05T10:00:00Z' })).toBe(
				true,
			);
		});

		it('keeps an active incomplete record eligible for processing', () => {
			expect(isTerminalRunRecord({ phase: 'PR_CREATE', finishedAt: null })).toBe(false);
		});
	});
});
