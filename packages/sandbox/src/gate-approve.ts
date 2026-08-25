// Positron — GATE_APPROVE Runtime Integration Hook
//
// Bridges the Stop/Ask Policy with the runtime state machine's GATE_APPROVE phase.
// Evaluates planned actions before execution and returns structured safety decisions
// with appropriate events for the pipeline.
//
// Issue #215: Safety: Integrate Stop/Ask Policy via GATE_APPROVE runtime hook

import type { EventLevel, Phase } from '@positron/shared';
import type {
	RepoRisk,
	StopAskActionCategory,
	StopAskDecision,
	StopAskRequest,
	StopAskRiskLevel,
} from './stop-ask-policy.js';
import { evaluateStopAsk } from './stop-ask-policy.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Minimal event record produced by the GATE_APPROVE hook.
 * Compatible with RunEventData shape from @positron/run-state
 * without importing that package directly.
 */
export interface GateEvent {
	/** Target phase for this event */
	phase: Phase;
	/** Event severity level */
	level: EventLevel;
	/** Human-readable message */
	message: string;
	/** Optional structured payload */
	payload: Record<string, unknown> | null;
}

/**
 * Input for the GATE_APPROVE hook — extends StopAskRequest
 * with optional runtime context fields.
 */
export interface GateApproveInput extends StopAskRequest {
	/** The run ID for event correlation (optional for standalone use) */
	runId?: string;
}

/**
 * Structured result from the GATE_APPROVE hook.
 */
export interface GateApproveResult {
	/** Whether the action may proceed */
	allowed: boolean;
	/** The safety decision from Stop/Ask evaluation */
	decision: StopAskDecision;
	/** Risk level */
	risk: StopAskRiskLevel;
	/** Human-readable reason */
	reason: string;
	/** Protocol category (A/B/C) */
	category: StopAskActionCategory;
	/** Whether human approval is required */
	humanApprovalRequired: boolean;
	/** Evidence required before the action can proceed */
	requiredEvidence: string[];
	/** Recommended next phase for the state machine */
	nextPhase: Phase;
	/** Events to record in the run log */
	events: GateEvent[];
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Evaluates a planned action through the Stop/Ask policy and returns
 * a structured decision suitable for the GATE_APPROVE state machine phase.
 *
 * Design:
 * - Calls the Stop/Ask policy (evaluateStopAsk) for the risk assessment
 * - Maps the Stop/Ask decision to a state machine outcome
 * - Produces appropriate GATE/HUMAN/ERROR events
 * - Never auto-approves a non-ALLOW decision
 * - Human approval is always preserved
 *
 * @param input — The action to evaluate
 * @returns Structured result with allowed flag, events, and next phase
 */
export function gateApproveAction(input: GateApproveInput): GateApproveResult {
	const stopAskResult = evaluateStopAsk(input);

	const { decision, risk, reason, category, humanApprovalRequired, requiredEvidence } =
		stopAskResult;

	// Map Stop/Ask decision to state machine outcome
	const allowed = decision === 'ALLOW';

	// Determine next phase based on decision
	let nextPhase: Phase;
	switch (decision) {
		case 'ALLOW':
			// Action can proceed — default to MERGE as a safe next step
			// (the actual next phase depends on the pipeline context)
			nextPhase = 'MERGE';
			break;
		case 'DENY':
			// Action is permanently blocked
			nextPhase = 'BLOCKED_MERGE';
			break;
		case 'ASK_HUMAN':
			// Action requires human decision — pause in GATE_APPROVE
			nextPhase = 'GATE_APPROVE';
			break;
		case 'REQUIRE_DRY_RUN':
		case 'REQUIRE_BACKUP':
		case 'REQUIRE_REVIEW':
			// Action requires evidence before proceeding
			nextPhase = 'GATE_APPROVE';
			break;
	}

	// Build events for the run log
	const events: GateEvent[] = [];

	if (allowed) {
		// Audit event for allowed actions
		events.push({
			phase: 'GATE_APPROVE',
			level: 'GATE',
			message: `Stop/Ask: ${decision} — ${reason}`,
			payload: {
				decision,
				risk,
				category,
				action: input.action,
				command: input.command ?? null,
				runId: input.runId ?? null,
			},
		});
	} else {
		// Block event for denied/gated actions
		events.push({
			phase: 'GATE_APPROVE',
			level: decision === 'DENY' ? 'ERROR' : 'GATE',
			message: `Stop/Ask: ${decision} — ${reason}`,
			payload: {
				decision,
				risk,
				category,
				action: input.action,
				command: input.command ?? null,
				requiredEvidence,
				humanApprovalRequired,
				runId: input.runId ?? null,
			},
		});

		// For ASK_HUMAN, also emit a HUMAN-level event to ensure
		// the pipeline knows human interaction is required
		if (decision === 'ASK_HUMAN') {
			events.push({
				phase: 'GATE_APPROVE',
				level: 'HUMAN',
				message: `Human approval required for: ${input.action}`,
				payload: {
					decision,
					risk,
					category,
					action: input.action,
					requiredEvidence,
					runId: input.runId ?? null,
				},
			});
		}
	}

	return {
		allowed,
		decision,
		risk,
		reason,
		category,
		humanApprovalRequired,
		requiredEvidence: [...requiredEvidence],
		nextPhase,
		events,
	};
}

// ─── Re-exports for convenience ──────────────────────────────────────────────

export type { RepoRisk, StopAskActionCategory, StopAskDecision, StopAskRiskLevel };
