// Positron Control Plane — fail-closed external workflow mutation boundary.
//
// This is an adapter contract, not an n8n controller. External systems may
// request a mutation; Positron decides whether that request is admissible.

import type { WorkflowMutationContract, WorkflowMutationAction } from './contracts.js';
import { validateContract } from './contracts.js';

const SECRET_LIKE = /(bearer\s+|api[_-]?key\s*[=:]|token\s*[=:]|password\s*[=:]|secret\s*[=:])/i;

export interface WorkflowMutationPolicyResult {
	allowed: boolean;
	reason_code: string;
	errors: string[];
}

function isWorkflowMutationAction(value: string): value is WorkflowMutationAction {
	return ['CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE', 'DELETE'].includes(value);
}

/**
 * Evaluate a workflow mutation request at the Positron policy boundary.
 *
 * Invariants:
 * - malformed or stale requests fail closed;
 * - protected workflows require a durable approval reference;
 * - deletion is never admitted by this boundary;
 * - provenance fields must not carry credential material;
 * - no external system receives lifecycle, retry, or promotion authority.
 */
export function evaluateWorkflowMutation(document: unknown): WorkflowMutationPolicyResult {
	const validation = validateContract('positron.workflow-mutation.v1', document);
	if (!validation.ok) {
		return {
			allowed: false,
			reason_code: 'WORKFLOW_MUTATION_CONTRACT_INVALID',
			errors: validation.errors,
		};
	}

	const request = document as WorkflowMutationContract;
	const errors: string[] = [];

	if (!isWorkflowMutationAction(request.action)) {
		errors.push(`unsupported workflow mutation action: ${request.action}`);
	}
	if (request.observed_sha256 !== request.baseline_sha256) {
		errors.push('observed workflow does not match the admitted baseline');
	}
	if (request.action === 'UPDATE' && request.proposed_sha256 === request.baseline_sha256) {
		errors.push('UPDATE must change the workflow fingerprint');
	}
	if (request.protected_workflow && !request.approval_ref) {
		errors.push('protected workflow mutation requires approval_ref');
	}
	const provenance = Object.values(request.provenance);
	if (provenance.some((value) => SECRET_LIKE.test(value))) {
		errors.push('provenance contains secret-like material');
	}

	if (request.action === 'DELETE') {
		return {
			allowed: false,
			reason_code: 'WORKFLOW_DELETE_DENIED',
			errors: [...errors, 'workflow deletion is outside the Positron adapter boundary'],
		};
	}
	if (errors.length > 0) {
		return { allowed: false, reason_code: 'WORKFLOW_MUTATION_REJECTED', errors };
	}
	return { allowed: true, reason_code: 'WORKFLOW_MUTATION_ALLOWED', errors: [] };
}
