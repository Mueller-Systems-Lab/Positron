import { describe, expect, it } from 'vitest';

import { evaluateWorkflowMutation } from '../workflow-mutation-policy.js';

const BASE = 'a'.repeat(64);
const PROPOSED = 'b'.repeat(64);

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contract: 'positron.workflow-mutation.v1',
		run_id: 'run-447-workflow',
		job_id: 'job-447-workflow',
		attempt_id: 'attempt-447-workflow',
		workflow_id: 'protected-workflow-1',
		action: 'UPDATE',
		protected_workflow: true,
		baseline_sha256: BASE,
		observed_sha256: BASE,
		proposed_sha256: PROPOSED,
		provenance: {
			adapter: 'n8n',
			source_ref: 'source-workflow-ref',
			evidence_ref: 'docs/evidence/issue-447/workflow.json',
		},
		approval_ref: 'approval-447',
		...overrides,
	};
}

describe('evaluateWorkflowMutation', () => {
	it('admits an approved protected update with an unchanged observed baseline', () => {
		expect(evaluateWorkflowMutation(request())).toEqual({
			allowed: true,
			reason_code: 'WORKFLOW_MUTATION_ALLOWED',
			errors: [],
		});
	});

	it('rejects a stale observed workflow before any mutation', () => {
		const result = evaluateWorkflowMutation(request({ observed_sha256: 'c'.repeat(64) }));
		expect(result.allowed).toBe(false);
		expect(result.reason_code).toBe('WORKFLOW_MUTATION_REJECTED');
		expect(result.errors).toContain('observed workflow does not match the admitted baseline');
	});

	it('rejects protected mutations without durable approval', () => {
		const result = evaluateWorkflowMutation(request({ approval_ref: undefined }));
		expect(result.allowed).toBe(false);
		expect(result.errors).toContain('protected workflow mutation requires approval_ref');
	});

	it('denies deletion even when the request is otherwise well formed', () => {
		const result = evaluateWorkflowMutation(request({ action: 'DELETE' }));
		expect(result.allowed).toBe(false);
		expect(result.reason_code).toBe('WORKFLOW_DELETE_DENIED');
	});

	it('rejects secret-like provenance and malformed contracts', () => {
		const secretResult = evaluateWorkflowMutation(
			request({ provenance: { adapter: 'n8n', source_ref: 'token=leaked', evidence_ref: 'ref' } }),
		);
		expect(secretResult.allowed).toBe(false);
		expect(secretResult.errors).toContain('provenance contains secret-like material');

		const malformed = evaluateWorkflowMutation({ contract: 'positron.workflow-mutation.v1' });
		expect(malformed.allowed).toBe(false);
		expect(malformed.reason_code).toBe('WORKFLOW_MUTATION_CONTRACT_INVALID');
	});
});
