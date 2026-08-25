// Positron — Safe Apply Plan Export Tests (Issue #279 Phase 1G)
// Red tests — written before implementation. All must eventually pass.

import { describe, expect, it } from 'vitest';
import type { ApprovalPackage, ApprovalPackReport } from '../human-approval-pack.js';
import { createSafeApplyPlanReport } from '../safe-apply-plan.js';

// ---------------------------------------------------------------------------
// Test fixtures — ApprovalPackage objects matching Phase 1F output shape
// ---------------------------------------------------------------------------

function makePackage(overrides: Partial<ApprovalPackage> = {}): ApprovalPackage {
	return {
		id: 'GREEN_SAFE_PACKAGE-1',
		type: 'GREEN_SAFE_PACKAGE',
		status: 'READY_FOR_APPROVAL',
		title: 'Safe Actions — Ready for Approval',
		summary: '3 safe action(s) ready for approval.',
		rowIds: ['act-1', 'act-2', 'act-3'],
		riskClasses: ['GREEN_SAFE'],
		recommendations: ['APPLY_GREEN_SAFE'],
		applyable: true,
		approvalPhrase: 'APPROVE APPLY GREEN_SAFE_PACKAGE GREEN_SAFE_PACKAGE-1',
		blockerReasons: [],
		warnings: [],
		...overrides,
	};
}

function makePackageReport(
	packages: ApprovalPackage[],
	status: ApprovalPackReport['status'] = 'PASS',
): ApprovalPackReport {
	const applyablePackages = packages.filter((p) => p.applyable).length;
	const reviewPackages = packages.filter((p) => p.type === 'YELLOW_REVIEW_PACKAGE').length;
	const holdPackages = packages.filter((p) => p.type === 'RED_HOLD_PACKAGE').length;
	const deferredPackages = packages.filter((p) => p.type === 'DEFER_TO_279_PACKAGE').length;

	return {
		status,
		totalPackages: packages.length,
		applyablePackages,
		reviewPackages,
		holdPackages,
		deferredPackages,
		packages,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSafeApplyPlanReport', () => {
	it('creates safe apply plan report from ApprovalPackReport', () => {
		const pkg = makePackage({ applyable: true });
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport).toBeDefined();
		expect(planReport.status).toBe('PASS');
		expect(planReport.totalPlans).toBeGreaterThanOrEqual(1);
		expect(planReport.plans).toBeDefined();
		expect(planReport.plans.length).toBeGreaterThanOrEqual(1);
	});

	it('every plan has executable=false', () => {
		const pkg = makePackage({ applyable: true });
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		for (const plan of planReport.plans) {
			expect(plan.executable).toBe(false);
		}
	});

	it('every plan action has executable=false', () => {
		const pkg = makePackage({ applyable: true });
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		for (const plan of planReport.plans) {
			for (const action of plan.actions) {
				expect(action.executable).toBe(false);
			}
		}
	});

	it('GREEN_SAFE_PACKAGE with applyable=true creates GREEN_SAFE_APPLY_PLAN', () => {
		const pkg = makePackage({ applyable: true });
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans.length).toBe(1);
		expect(planReport.plans[0]!.type).toBe('GREEN_SAFE_APPLY_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false); // still not executable
	});

	it('GREEN_SAFE_PACKAGE with blockers creates BLOCKED_PLAN', () => {
		const pkg = makePackage({
			applyable: false,
			blockerReasons: ['blocked by local gate failure'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('BLOCKED_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
	});

	it('GREEN_SAFE + DO_NOT_APPLY remains blocked through approval pack input', () => {
		const pkg = makePackage({
			applyable: false,
			recommendations: ['DO_NOT_APPLY'],
			blockerReasons: ['2 row(s) are GREEN_SAFE but not APPLY_GREEN_SAFE'],
			status: 'REVIEW_REQUIRED',
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('BLOCKED_PLAN');
		expect(planReport.blockedPlans).toBe(1);
	});

	it('failing required local gate blocks green apply plan', () => {
		const pkg = makePackage({
			applyable: false,
			blockerReasons: ['Local required/format gates have failures — applyable packages blocked.'],
		});
		const report = makePackageReport([pkg], 'FAIL');

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('BLOCKED_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
	});

	it('YELLOW_REVIEW_PACKAGE becomes YELLOW_REVIEW_PLAN', () => {
		const pkg = makePackage({
			id: 'YELLOW_REVIEW_PACKAGE-1',
			type: 'YELLOW_REVIEW_PACKAGE',
			status: 'REVIEW_REQUIRED',
			title: 'Actions Requiring Human Review',
			summary: '1 action(s) require human review before proceeding.',
			applyable: false,
			approvalPhrase: 'APPROVE REVIEW YELLOW_REVIEW_PACKAGE YELLOW_REVIEW_PACKAGE-1',
			riskClasses: ['YELLOW_REVIEW'],
			recommendations: ['REVIEW_REQUIRED'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('YELLOW_REVIEW_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
	});

	it('RED_HOLD_PACKAGE becomes RED_HOLD_PLAN', () => {
		const pkg = makePackage({
			id: 'RED_HOLD_PACKAGE-1',
			type: 'RED_HOLD_PACKAGE',
			status: 'HOLD',
			title: 'Held Actions — Do Not Touch',
			summary: '2 action(s) are held — do not touch without explicit approval.',
			applyable: false,
			approvalPhrase: 'HOLD RED_HOLD_PACKAGE RED_HOLD_PACKAGE-1',
			riskClasses: ['RED_HOLD'],
			recommendations: ['HOLD'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('RED_HOLD_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
	});

	it('TOOL_GAP_PACKAGE becomes TOOL_GAP_PLAN', () => {
		const pkg = makePackage({
			id: 'TOOL_GAP_PACKAGE-1',
			type: 'TOOL_GAP_PACKAGE',
			status: 'BLOCKED',
			title: 'Actions Needing Validation — Tool Gap / Unknown',
			summary: '1 action(s) need validation — tool gap or unknown status.',
			applyable: false,
			approvalPhrase: 'NEEDS VALIDATION TOOL_GAP_PACKAGE TOOL_GAP_PACKAGE-1',
			riskClasses: ['TOOL_GAP'],
			recommendations: ['DO_NOT_APPLY'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('TOOL_GAP_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
	});

	it('DEFER_TO_279_PACKAGE becomes DEFER_TO_279_PLAN', () => {
		const pkg = makePackage({
			id: 'DEFER_TO_279_PACKAGE-1',
			type: 'DEFER_TO_279_PACKAGE',
			status: 'DEFER',
			title: 'Architecture Decisions — Deferred to Issue #279',
			summary: '1 architecture decision(s) deferred to Issue #279.',
			applyable: false,
			approvalPhrase: 'DEFER DEFER_TO_279_PACKAGE DEFER_TO_279_PACKAGE-1 TO ISSUE 279',
			riskClasses: ['DEFER_TO_279'],
			recommendations: ['DEFER'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('DEFER_TO_279_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
	});

	it('MIXED_RISK_PACKAGE becomes BLOCKED_PLAN', () => {
		const pkg = makePackage({
			id: 'MIXED_RISK_PACKAGE-1',
			type: 'MIXED_RISK_PACKAGE',
			status: 'BLOCKED',
			title: 'Mixed-Risk Actions — Review Required',
			summary: '2 action(s) with mixed risk levels — review required.',
			applyable: false,
			approvalPhrase: 'APPROVE REVIEW MIXED_RISK_PACKAGE MIXED_RISK_PACKAGE-1',
			riskClasses: ['GREEN_SAFE', 'YELLOW_REVIEW'],
			recommendations: ['APPLY_GREEN_SAFE', 'REVIEW_REQUIRED'],
			blockerReasons: ['Mixed risk classes present'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('BLOCKED_PLAN');
	});

	it('approval phrase is preserved but not executed in plan', () => {
		const pkg = makePackage({
			applyable: true,
			approvalPhrase: 'APPROVE APPLY GREEN_SAFE_PACKAGE GREEN_SAFE_PACKAGE-1',
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.actions[0]!.approvalPhrase).toBe(
			'APPROVE APPLY GREEN_SAFE_PACKAGE GREEN_SAFE_PACKAGE-1',
		);
		expect(planReport.plans[0]!.executable).toBe(false);
		expect(planReport.plans[0]!.actions[0]!.executable).toBe(false);
	});

	it('JSON serialization is stable (deterministic output)', () => {
		const pkg = makePackage({ applyable: true });
		const report = makePackageReport([pkg]);

		const planReport1 = createSafeApplyPlanReport(report);
		const planReport2 = createSafeApplyPlanReport(report);

		expect(JSON.stringify(planReport1)).toBe(JSON.stringify(planReport2));
	});

	it('executablePlans is always 0', () => {
		const pkg = makePackage({ applyable: true });
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.executablePlans).toBe(0);
	});

	it('plan summary counts are correct', () => {
		const greenPkg = makePackage({
			id: 'GREEN_SAFE_PACKAGE-1',
			applyable: true,
		});
		const yellowPkg = makePackage({
			id: 'YELLOW_REVIEW_PACKAGE-1',
			type: 'YELLOW_REVIEW_PACKAGE',
			status: 'REVIEW_REQUIRED',
			applyable: false,
			approvalPhrase: 'APPROVE REVIEW YELLOW_REVIEW_PACKAGE YELLOW_REVIEW_PACKAGE-1',
			riskClasses: ['YELLOW_REVIEW'],
			recommendations: ['REVIEW_REQUIRED'],
		});
		const redPkg = makePackage({
			id: 'RED_HOLD_PACKAGE-1',
			type: 'RED_HOLD_PACKAGE',
			status: 'HOLD',
			applyable: false,
			approvalPhrase: 'HOLD RED_HOLD_PACKAGE RED_HOLD_PACKAGE-1',
			riskClasses: ['RED_HOLD'],
			recommendations: ['HOLD'],
		});
		const deferPkg = makePackage({
			id: 'DEFER_TO_279_PACKAGE-1',
			type: 'DEFER_TO_279_PACKAGE',
			status: 'DEFER',
			applyable: false,
			approvalPhrase: 'DEFER DEFER_TO_279_PACKAGE DEFER_TO_279_PACKAGE-1 TO ISSUE 279',
			riskClasses: ['DEFER_TO_279'],
			recommendations: ['DEFER'],
		});
		const report = makePackageReport([greenPkg, yellowPkg, redPkg, deferPkg], 'FAIL');

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.totalPlans).toBe(4);
		expect(planReport.blockedPlans).toBe(0); // GREEN_SAFE_APPLY_PLAN is not blocked
		expect(planReport.reviewPlans).toBe(1);
		expect(planReport.holdPlans).toBe(1);
		expect(planReport.deferredPlans).toBe(1);
	});

	it('plan contains evidence references when provided (as warnings / blockerReasons)', () => {
		const pkg = makePackage({
			applyable: true,
			warnings: ['See evidence: docs/evidence/report-1.md'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.warnings).toContain('See evidence: docs/evidence/report-1.md');
	});

	it('no execute/apply function exists — module exports only createSafeApplyPlanReport', async () => {
		const mod = await import('../safe-apply-plan.js');

		// Only the plan creation function and types should be exported
		expect(typeof mod.createSafeApplyPlanReport).toBe('function');

		// No execute, apply, run, or mutate functions
		// Use dynamic property access since these properties don't exist on the type
		expect((mod as Record<string, unknown>).executeSafeApplyPlan).toBeUndefined();
		expect((mod as Record<string, unknown>).applySafeApplyPlan).toBeUndefined();
		expect((mod as Record<string, unknown>).runSafeApplyPlan).toBeUndefined();
		expect((mod as Record<string, unknown>).executePlans).toBeUndefined();
		expect((mod as Record<string, unknown>).applyPlans).toBeUndefined();
	});

	it('PR #218-like approval pack becomes YELLOW_REVIEW_PLAN', () => {
		const pkg = makePackage({
			id: 'YELLOW_REVIEW_PACKAGE-1',
			type: 'YELLOW_REVIEW_PACKAGE',
			status: 'REVIEW_REQUIRED',
			title: 'Actions Requiring Human Review',
			summary: '1 action(s) require human review before proceeding.',
			applyable: false,
			approvalPhrase: 'APPROVE REVIEW YELLOW_REVIEW_PACKAGE YELLOW_REVIEW_PACKAGE-1',
			riskClasses: ['YELLOW_REVIEW'],
			recommendations: ['REVIEW_REQUIRED'],
			warnings: [
				'1 item(s) require human review — external AI reviewer/security findings may apply.',
			],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('YELLOW_REVIEW_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
	});

	it('Issue #279-like approval pack becomes DEFER_TO_279_PLAN', () => {
		const pkg = makePackage({
			id: 'DEFER_TO_279_PACKAGE-1',
			type: 'DEFER_TO_279_PACKAGE',
			status: 'DEFER',
			title: 'Architecture Decisions — Deferred to Issue #279',
			summary: '3 architecture decision(s) deferred to Issue #279.',
			applyable: false,
			approvalPhrase: 'DEFER DEFER_TO_279_PACKAGE DEFER_TO_279_PACKAGE-1 TO ISSUE 279',
			riskClasses: ['DEFER_TO_279'],
			recommendations: ['DEFER'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('DEFER_TO_279_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
	});

	it('empty report (no packages) creates NO_ACTION_PLAN', () => {
		const report = makePackageReport([]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.totalPlans).toBe(1);
		expect(planReport.plans[0]!.type).toBe('NO_ACTION_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
		expect(planReport.executablePlans).toBe(0);
	});

	it('GREEN_SAFE_APPLY_PLAN still has executable=false (never executable)', () => {
		const pkg = makePackage({
			applyable: true,
			recommendations: ['APPLY_GREEN_SAFE'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.type).toBe('GREEN_SAFE_APPLY_PLAN');
		expect(planReport.plans[0]!.executable).toBe(false);
		// The plan describes what COULD be done — never executes
	});

	it('plan actions include correct row IDs from package', () => {
		const pkg = makePackage({
			applyable: true,
			rowIds: ['issue-279', 'issue-268', 'pr-218'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.actions.length).toBe(3);
		const actionIds = planReport.plans[0]!.actions.map((a) => a.id);
		expect(actionIds).toContain('issue-279');
		expect(actionIds).toContain('issue-268');
		expect(actionIds).toContain('pr-218');
	});

	it('blocker reasons are propagated from package to plan', () => {
		const pkg = makePackage({
			applyable: false,
			blockerReasons: ['Local required/format gates have failures'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.blockerReasons).toContain(
			'Local required/format gates have failures',
		);
	});

	it('package warnings are propagated to plan warnings', () => {
		const pkg = makePackage({
			applyable: true,
			warnings: ['Warning A', 'Warning B'],
		});
		const report = makePackageReport([pkg]);

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.plans[0]!.warnings).toContain('Warning A');
		expect(planReport.plans[0]!.warnings).toContain('Warning B');
	});

	it('status reflects package report status', () => {
		const redPkg = makePackage({
			id: 'RED_HOLD_PACKAGE-1',
			type: 'RED_HOLD_PACKAGE',
			status: 'HOLD',
			applyable: false,
			approvalPhrase: 'HOLD RED_HOLD_PACKAGE RED_HOLD_PACKAGE-1',
			riskClasses: ['RED_HOLD'],
			recommendations: ['HOLD'],
		});
		const report = makePackageReport([redPkg], 'FAIL');

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.status).toBe('FAIL');
	});

	it('WARN status propagates correctly', () => {
		const yellowPkg = makePackage({
			id: 'YELLOW_REVIEW_PACKAGE-1',
			type: 'YELLOW_REVIEW_PACKAGE',
			status: 'REVIEW_REQUIRED',
			applyable: false,
			approvalPhrase: 'APPROVE REVIEW YELLOW_REVIEW_PACKAGE YELLOW_REVIEW_PACKAGE-1',
			riskClasses: ['YELLOW_REVIEW'],
			recommendations: ['REVIEW_REQUIRED'],
		});
		const report = makePackageReport([yellowPkg], 'WARN');

		const planReport = createSafeApplyPlanReport(report);

		expect(planReport.status).toBe('WARN');
	});
});
