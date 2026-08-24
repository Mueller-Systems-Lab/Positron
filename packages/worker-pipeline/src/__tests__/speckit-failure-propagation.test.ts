import { describe, expect, test } from 'vitest';
import { openCodeFailureUpdate } from '../pipeline-runner.js';

describe('SpecKit/OpenCode failure propagation', () => {
	test('persists the local server boundary as HARNESS with a delta route', () => {
		const update = openCodeFailureUpdate('specify', {
			phase: 'specify',
			status: 'failed',
			command: 'opencode run',
			args: ['run', '--dir', '/disposable'],
			cwd: '/disposable',
			exitCode: 0,
			durationMs: 10,
			summary: 'failed',
			error: {
				name: 'UnknownError',
				message: 'Unexpected server error. Check server logs for details.',
				ref: 'err_boundary_test',
			},
		});

		expect(update.failure_class).toBe('CONTEXT_FAILURE');
		expect(update.failure_domain).toBe('HARNESS');
		expect(update.diagnosis_reason_code).toBe('DIAGNOSIS_HARNESS_CONTEXT');
		expect(update.routing_action).toBe('RETRY_WITH_HARNESS_DELTA');
		expect(update.failure_signature).toBe('specify:CONTEXT_FAILURE:err_boundary_test');
		expect(update.result_ref).toBe('opencode:specify:err_boundary_test');
	});
});
