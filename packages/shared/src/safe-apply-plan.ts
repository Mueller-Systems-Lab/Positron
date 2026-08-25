// Positron — Safe Apply Plan Export (Issue #279 Phase 1G)
// Translates Human Approval Pack Reports (Phase 1F) into non-executing,
// auditable apply plans. Every plan and action explicitly has executable=false.
//
// Pure functions only. No GitHub API calls, no shell execution,
// no mutations, no network, no file system writes.

import type { ApprovalPackage, ApprovalPackReport } from './human-approval-pack.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Safe Apply Plan classification. */
export type SafeApplyPlanType =
	| 'NO_ACTION_PLAN'
	| 'GREEN_SAFE_APPLY_PLAN'
	| 'YELLOW_REVIEW_PLAN'
	| 'RED_HOLD_PLAN'
	| 'TOOL_GAP_PLAN'
	| 'DEFER_TO_279_PLAN'
	| 'BLOCKED_PLAN';

/** A single planned action — always non-executing. */
export interface SafeApplyPlanAction {
	/** Unique identifier for this action (matches package rowId). */
	id: string;
	/** Package type the action originated from. */
	type: string;
	/** What kind of GitHub entity this action targets. */
	targetType: 'issue' | 'pull_request' | 'repository' | 'unknown';
	/** The numeric or string ID of the target, if known. */
	targetId: string | null;
	/** Human-readable title for this action. */
	title: string;
	/** One-sentence description. */
	description: string;
	/** The approval phrase from the parent package, preserved verbatim. */
	approvalPhrase: string | null;
	/** Always false — SafeApplyPlan never executes anything. */
	executable: false;
	/** Whether this action is blocked. */
	blocked: boolean;
	/** Reasons why this action is blocked (empty if not blocked). */
	blockerReasons: string[];
	/** References to evidence documents supporting this decision. */
	evidenceRefs: string[];
}

/** A single safe apply plan — always non-executing. */
export interface SafeApplyPlan {
	/** Unique plan identifier. */
	id: string;
	/** Classification of this plan. */
	type: SafeApplyPlanType;
	/** The ID of the ApprovalPackage this plan was derived from. */
	packageId: string;
	/** Human-readable title. */
	title: string;
	/** One-sentence summary. */
	summary: string;
	/** Always false — SafeApplyPlan never executes anything. */
	executable: false;
	/** Actions in this plan — all non-executing. */
	actions: SafeApplyPlanAction[];
	/** Reasons why this plan is blocked (empty if not blocked). */
	blockerReasons: string[];
	/** Non-blocking warnings. */
	warnings: string[];
}

/** Top-level report from the Safe Apply Plan Export. */
export interface SafeApplyPlanReport {
	/** Overall status. */
	status: 'PASS' | 'WARN' | 'FAIL';
	/** Total number of plans. */
	totalPlans: number;
	/** Always 0 — type-level enforcement. SafeApplyPlan never executes. */
	executablePlans: 0;
	/** Number of blocked plans. */
	blockedPlans: number;
	/** Number of review plans (YELLOW_REVIEW_PLAN). */
	reviewPlans: number;
	/** Number of hold plans (RED_HOLD_PLAN). */
	holdPlans: number;
	/** Number of deferred plans (DEFER_TO_279_PLAN). */
	deferredPlans: number;
	/** All plans in this report. */
	plans: SafeApplyPlan[];
}

// ---------------------------------------------------------------------------
// Mapping constants
// ---------------------------------------------------------------------------

/** Maps ApprovalPackage type to SafeApplyPlan type. */
const PACKAGE_TYPE_TO_PLAN_TYPE: Record<string, SafeApplyPlanType> = {
	GREEN_SAFE_PACKAGE: 'GREEN_SAFE_APPLY_PLAN',
	YELLOW_REVIEW_PACKAGE: 'YELLOW_REVIEW_PLAN',
	RED_HOLD_PACKAGE: 'RED_HOLD_PLAN',
	TOOL_GAP_PACKAGE: 'TOOL_GAP_PLAN',
	DEFER_TO_279_PACKAGE: 'DEFER_TO_279_PLAN',
	MIXED_RISK_PACKAGE: 'BLOCKED_PLAN',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a targetType from a rowId (action_id).
 * Heuristic: if the ID starts with "pr-" or "pull-", it's a pull_request.
 * If it starts with "issue-", it's an issue. Otherwise unknown.
 */
function deriveTargetType(rowId: string): SafeApplyPlanAction['targetType'] {
	const lower = rowId.toLowerCase();
	if (lower.startsWith('pr-') || lower.startsWith('pull-') || lower.startsWith('pull_request-')) {
		return 'pull_request';
	}
	if (lower.startsWith('issue-')) {
		return 'issue';
	}
	if (lower.startsWith('repo-')) {
		return 'repository';
	}
	return 'unknown';
}

/**
 * Derive a targetId from a rowId.
 * Extracts numeric suffix if possible, otherwise returns the full rowId.
 */
function deriveTargetId(rowId: string): string | null {
	// Try to extract a numeric ID from patterns like "issue-279" or "pr-218"
	const match = rowId.match(/-(\d+)$/);
	if (match) {
		return match[1]!;
	}
	// Fallback: return the full rowId as the target
	return rowId;
}

/**
 * Build a human-readable title for a plan action.
 */
function buildActionTitle(rowId: string, pkgType: string): string {
	return `Action ${rowId} — ${pkgType}`;
}

/**
 * Build a one-sentence description for a plan action.
 */
function buildActionDescription(rowId: string, pkgType: string, blocked: boolean): string {
	if (blocked) {
		return `Blocked action: ${rowId} (${pkgType}) — requires resolution of blockers.`;
	}
	return `Planned action: ${rowId} (${pkgType}) — not executing, awaiting approval.`;
}

/**
 * Build plan summary text.
 */
function buildPlanSummary(type: SafeApplyPlanType, actionCount: number): string {
	switch (type) {
		case 'NO_ACTION_PLAN':
			return 'No actions to plan. Report is empty.';
		case 'GREEN_SAFE_APPLY_PLAN':
			return `${actionCount} safe action(s) could be applied after human approval. Not executing.`;
		case 'YELLOW_REVIEW_PLAN':
			return `${actionCount} action(s) require human review. Not executing.`;
		case 'RED_HOLD_PLAN':
			return `${actionCount} held action(s) — do not touch without explicit approval. Not executing.`;
		case 'TOOL_GAP_PLAN':
			return `${actionCount} action(s) need validation — tool gap or unknown status. Not executing.`;
		case 'DEFER_TO_279_PLAN':
			return `${actionCount} architecture decision(s) deferred to Issue #279. Not executing.`;
		case 'BLOCKED_PLAN':
			return `${actionCount} action(s) blocked — cannot proceed. Not executing.`;
		default:
			return `${actionCount} action(s) in this plan. Not executing.`;
	}
}

/**
 * Build a human-readable plan title.
 */
function buildPlanTitle(type: SafeApplyPlanType): string {
	switch (type) {
		case 'NO_ACTION_PLAN':
			return 'No Actions Planned';
		case 'GREEN_SAFE_APPLY_PLAN':
			return 'Safe Apply Plan — Awaiting Human Approval';
		case 'YELLOW_REVIEW_PLAN':
			return 'Review Plan — Human Review Required';
		case 'RED_HOLD_PLAN':
			return 'Hold Plan — Do Not Touch';
		case 'TOOL_GAP_PLAN':
			return 'Validation Plan — Tool Gap / Unknown';
		case 'DEFER_TO_279_PLAN':
			return 'Deferral Plan — Architecture Decision Required';
		case 'BLOCKED_PLAN':
			return 'Blocked Plan — Cannot Apply';
		default:
			return `Plan: ${type}`;
	}
}

/**
 * Collect evidence references from package warnings and blocker reasons.
 * Extracts strings that look like file paths or issue references.
 */
function collectEvidenceRefs(pkg: ApprovalPackage): string[] {
	const refs: string[] = [];

	for (const warning of pkg.warnings) {
		if (
			warning.includes('docs/') ||
			warning.includes('evidence/') ||
			warning.includes('.opencode/')
		) {
			refs.push(warning);
		}
	}
	for (const blocker of pkg.blockerReasons) {
		if (
			blocker.includes('docs/') ||
			blocker.includes('evidence/') ||
			blocker.includes('.opencode/')
		) {
			refs.push(blocker);
		}
	}

	return refs;
}

// ---------------------------------------------------------------------------
// Core transformation
// ---------------------------------------------------------------------------

/**
 * Transform a single ApprovalPackage into a SafeApplyPlan.
 */
function packageToPlan(pkg: ApprovalPackage): SafeApplyPlan {
	// Determine plan type
	let planType: SafeApplyPlanType;
	if (pkg.type === 'GREEN_SAFE_PACKAGE' && pkg.applyable) {
		planType = 'GREEN_SAFE_APPLY_PLAN';
	} else if (pkg.type === 'GREEN_SAFE_PACKAGE' && !pkg.applyable) {
		planType = 'BLOCKED_PLAN';
	} else {
		planType = PACKAGE_TYPE_TO_PLAN_TYPE[pkg.type] ?? 'BLOCKED_PLAN';
	}

	const actions: SafeApplyPlanAction[] = pkg.rowIds.map((rowId) => {
		const blocked = !pkg.applyable;
		return {
			id: rowId,
			type: pkg.type,
			targetType: deriveTargetType(rowId),
			targetId: deriveTargetId(rowId),
			title: buildActionTitle(rowId, pkg.type),
			description: buildActionDescription(rowId, pkg.type, blocked),
			approvalPhrase: pkg.approvalPhrase,
			executable: false as const,
			blocked,
			blockerReasons: blocked ? [...pkg.blockerReasons] : [],
			evidenceRefs: collectEvidenceRefs(pkg),
		};
	});

	return {
		id: planType === 'GREEN_SAFE_APPLY_PLAN' ? `plan-${pkg.id}` : `blocked-plan-${pkg.id}`,
		type: planType,
		packageId: pkg.id,
		title: buildPlanTitle(planType),
		summary: buildPlanSummary(planType, actions.length),
		executable: false as const,
		actions,
		blockerReasons: [...pkg.blockerReasons],
		warnings: [...pkg.warnings],
	};
}

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

/**
 * Sort plans deterministically:
 * GREEN_SAFE_APPLY_PLAN first, then YELLOW_REVIEW, RED_HOLD, TOOL_GAP,
 * DEFER_TO_279, BLOCKED, NO_ACTION last.
 */
const PLAN_TYPE_ORDER: Record<SafeApplyPlanType, number> = {
	GREEN_SAFE_APPLY_PLAN: 0,
	YELLOW_REVIEW_PLAN: 1,
	RED_HOLD_PLAN: 2,
	TOOL_GAP_PLAN: 3,
	DEFER_TO_279_PLAN: 4,
	BLOCKED_PLAN: 5,
	NO_ACTION_PLAN: 6,
};

function sortPlans(plans: SafeApplyPlan[]): SafeApplyPlan[] {
	return [...plans].sort((a, b) => {
		const orderA = PLAN_TYPE_ORDER[a.type] ?? 99;
		const orderB = PLAN_TYPE_ORDER[b.type] ?? 99;
		return orderA - orderB;
	});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a Safe Apply Plan Report from a Human Approval Pack Report.
 *
 * Translates owner-facing decision packages into non-executing,
 * auditable apply plans. Every plan and action explicitly has executable=false.
 *
 * Pure function. No side effects. No action execution. No GitHub mutations.
 *
 * @param approvalPackReport - ApprovalPackReport from Phase 1F.
 * @returns SafeApplyPlanReport with non-executing plans.
 */
export function createSafeApplyPlanReport(
	approvalPackReport: ApprovalPackReport,
): SafeApplyPlanReport {
	const plans: SafeApplyPlan[] = [];

	// Handle empty report
	if (approvalPackReport.packages.length === 0) {
		plans.push({
			id: 'plan-NO_ACTION_PLAN-1',
			type: 'NO_ACTION_PLAN',
			packageId: 'none',
			title: buildPlanTitle('NO_ACTION_PLAN'),
			summary: buildPlanSummary('NO_ACTION_PLAN', 0),
			executable: false as const,
			actions: [],
			blockerReasons: [],
			warnings: [],
		});
	} else {
		for (const pkg of approvalPackReport.packages) {
			plans.push(packageToPlan(pkg));
		}
	}

	// Sort deterministically
	const sortedPlans = sortPlans(plans);

	// Count plan types
	const blockedPlans = sortedPlans.filter((p) => p.type === 'BLOCKED_PLAN').length;
	const reviewPlans = sortedPlans.filter((p) => p.type === 'YELLOW_REVIEW_PLAN').length;
	const holdPlans = sortedPlans.filter((p) => p.type === 'RED_HOLD_PLAN').length;
	const deferredPlans = sortedPlans.filter((p) => p.type === 'DEFER_TO_279_PLAN').length;

	// Determine overall status
	let status: SafeApplyPlanReport['status'] = 'PASS';
	if (approvalPackReport.status === 'FAIL') {
		status = 'FAIL';
	} else if (approvalPackReport.status === 'WARN') {
		status = 'WARN';
	} else if (sortedPlans.some((p) => p.type === 'RED_HOLD_PLAN' || p.type === 'BLOCKED_PLAN')) {
		status = 'FAIL';
	} else if (
		sortedPlans.some(
			(p) =>
				p.type === 'YELLOW_REVIEW_PLAN' ||
				p.type === 'TOOL_GAP_PLAN' ||
				p.type === 'DEFER_TO_279_PLAN',
		)
	) {
		status = 'WARN';
	}

	return {
		status,
		totalPlans: sortedPlans.length,
		executablePlans: 0,
		blockedPlans,
		reviewPlans,
		holdPlans,
		deferredPlans,
		plans: sortedPlans,
	};
}
