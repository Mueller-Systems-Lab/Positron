// Positron — GATE_APPROVE Server Runtime Handler
//
// Issue #332: Extracted adapter function that wires gateApproveAction()
// from the sandbox package into the server's executePhase pipeline.
//
// This narrow adapter is extractable for isolated testing while
// keeping the server code minimal and fail-closed.
//
// Safety invariants:
// - Non-ALLOW never proceeds to COMMIT/MERGE
// - Exception / missing input → fail closed
// - Existing Gate 9 / onAudit behavior is not weakened

import type { RunState } from '@positron/run-state';
import type { GateApproveInput, GateApproveResult } from '@positron/sandbox';
import { gateApproveAction } from '@positron/sandbox';
import type { Phase } from '@positron/shared';

/**
 * Outcome of GATE_APPROVE handler — determines how the server
 * routes the run after Stop/Ask policy evaluation.
 */
export type GateApproveOutcome =
	| { kind: 'TRANSITION'; to: Phase; message: string; payload: Record<string, unknown> | null }
	| { kind: 'FAILED_BLOCKED'; message: string }
	| { kind: 'STAY'; message: string };

/**
 * Wraps the gateApproveAction() call with server-specific
 * routing logic for the GATE_APPROVE phase.
 *
 * The handler extracts the pipeline action context from the run state
 * and builds a StopAskRequest that the policy can meaningfully evaluate.
 * The action is derived from the gate failure context (lastError) and
 * the run's target phase to produce descriptions like "merge to main
 * branch for issue #42" that match Stop/Ask policy patterns.
 *
 * @param run — Current RunState
 * @param repoRisk — Repository risk context (default: 'TEST' for Fake Mode)
 * @returns Structured outcome for the state machine to route
 */
export function handleGateApprove(
	run: RunState,
	repoRisk: 'TEST' | 'LOW' | 'PRODUCTION' | 'CRITICAL' = 'TEST',
): { outcome: GateApproveOutcome; events: GateApproveResult['events'] } {
	// Derive the pipeline action being gated from the run context.
	// lastError from tryTransitionWithGates contains the gate failure
	// reason, e.g. "Human approval required before MERGE: evidence needed".
	// Strip the gate boilerplate to extract the actual action context.
	const lastErr = run.lastError ?? '';
	const phaseMatch = /before\s+(\w+)/i.exec(lastErr);
	const targetPhase = phaseMatch?.[1] ?? run.phase;

	// Strip gate boilerplate to extract meaningful action context.
	// Patterns like "Human approval required before <PHASE>: <rest>"
	// are trimmed to just "<rest>" for policy evaluation.
	const strippedContext = lastErr.replace(/^(Human|Gate)\s+.*?:\s*/i, '').trim();

	// Build a descriptive action that Stop/Ask policy patterns can match.
	// Pipeline-specific actions:
	// - merge to main/master → Category A DENY (push to protected branch)
	// - merge to feature → Category B REQUIRE_REVIEW
	// - commit/push → Category C ALLOW (in TEST mode)
	const action = buildPipelineAction(targetPhase, run.issueNumber, strippedContext, lastErr);

	const gateInput: GateApproveInput = {
		runId: run.id,
		action,
		target: `issue-${run.issueNumber}`,
		repoRisk,
	};

	const gateResult = gateApproveAction(gateInput);

	// Route based on Stop/Ask decision outcome
	let outcome: GateApproveOutcome;

	switch (gateResult.decision) {
		case 'ALLOW':
			outcome = {
				kind: 'TRANSITION',
				to: 'MERGE',
				message: `GATE_APPROVE: ALLOW — ${gateResult.reason}`,
				payload: {
					decision: gateResult.decision,
					risk: gateResult.risk,
					category: gateResult.category,
				},
			};
			break;

		case 'DENY':
			outcome = {
				kind: 'FAILED_BLOCKED',
				message: `GATE_APPROVE: DENY — ${gateResult.reason}`,
			};
			break;

		case 'ASK_HUMAN':
			outcome = {
				kind: 'STAY',
				message: `Human approval required: ${gateResult.reason}`,
			};
			break;

		case 'REQUIRE_DRY_RUN':
			outcome = {
				kind: 'STAY',
				message: `Dry-run required: ${gateResult.requiredEvidence.join(', ')}`,
			};
			break;

		case 'REQUIRE_BACKUP':
			outcome = {
				kind: 'STAY',
				message: `Backup required: ${gateResult.requiredEvidence.join(', ')}`,
			};
			break;

		case 'REQUIRE_REVIEW':
			outcome = {
				kind: 'STAY',
				message: `Review required: ${gateResult.requiredEvidence.join(', ')}`,
			};
			break;

		default:
			// Exhaustive check — unknown decision is fail-closed
			outcome = {
				kind: 'FAILED_BLOCKED',
				message: `GATE_APPROVE: unknown decision "${gateResult.decision}" — fail closed`,
			};
			break;
	}

	return { outcome, events: gateResult.events };
}

/**
 * Re-exports for convenience — these types are used by the server
 * when handling GATE_APPROVE events.
 */
export type { GateApproveInput, GateApproveResult };

/**
 * Builds a human-readable pipeline action description that the
 * Stop/Ask policy can meaningfully evaluate.
 *
 * The description is constructed from the target phase and issue
 * context to produce patterns like "git merge to main branch for
 * issue #42" that match Category A/B policy rules.
 *
 * If the context message already contains Stop/Ask-relevant
 * action keywords (database migration, npm install, etc.),
 * those are used directly for more accurate policy matching.
 */
function buildPipelineAction(
	targetPhase: string,
	issueNumber: number,
	strippedContext: string,
	rawContext: string,
): string {
	// Check if the stripped context already describes a Stop/Ask-relevant action.
	// The stripped context has gate boilerplate removed (e.g., "database migration needed"
	// instead of "Human approval required before MERGE: database migration needed").
	// This prevents phase names like "MERGE" from triggering false policy matches.
	const stopAskPatterns = [
		/\bdatabase\s+migration\b/i,
		/\bdatabase\s+schema\s+change\b/i,
		/\bnpm\s+install\b/i,
		/\brm\s+-rf\b/i,
		/\bgit\s+push\s+--force\b/i,
		/\bgit\s+merge\b/i,
		/\bDELETE\s+FROM\b/i,
		/\bDROP\s+(TABLE|DATABASE)\b/i,
		/\bexternal\s+deployment\b/i,
		/\bconfig\b.*\bmodification\b/i,
		/\bdelete\s+branch\b/i,
	];

	// Use the stripped context for pattern detection to avoid
	// matching gate boilerplate words (like "MERGE") as actions.
	const contextForAction = strippedContext || rawContext;

	for (const pattern of stopAskPatterns) {
		if (pattern.test(contextForAction)) {
			return `${contextForAction.trim()} for issue #${issueNumber}`;
		}
	}

	// No Stop/Ask pattern found — build a pipeline action description.
	// Use rawContext for branch name detection (may contain "main"/"master"
	// info that was stripped from the message).
	const upper = targetPhase.toUpperCase();

	if (upper === 'MERGE') {
		if (/\b(main|master)\b/i.test(rawContext)) {
			return `git merge to main branch for issue #${issueNumber}`;
		}
		return `merge feature branch for issue #${issueNumber}`;
	}

	if (upper === 'PR_CREATE') {
		return `create pull request for issue #${issueNumber}`;
	}

	if (upper === 'COMMIT') {
		if (/\b(main|master)\b/i.test(rawContext)) {
			return `push to main branch for issue #${issueNumber}`;
		}
		return `commit changes for issue #${issueNumber}`;
	}

	return `pipeline transition to ${targetPhase} for issue #${issueNumber}`;
}
