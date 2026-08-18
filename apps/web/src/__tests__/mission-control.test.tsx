// Positron Web — Active Run Mission Control Tests (P2)
//
// Backend-Truth-Prinzip: Alle Fixtures spiegeln 1:1 die Antwortform der
// read-only Backend-Truth-API (GET /api/runs/:id/control-plane). Die UI
// erfindet keinen Zustand — die Tests verifizieren die reale Projektion.

import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
	ControlPlaneAttempt,
	ControlPlaneDecision,
	ControlPlaneJob,
	ControlPlaneResponse,
} from '../api.js';
import MissionControlPanel from '../components/mission/MissionControlPanel.js';

// ── Backend-Truth-Fixture (reale Antwortform des Endpoints) ─────────────

const jobs: ControlPlaneJob[] = [
	{
		job_id: 'job_intake',
		run_id: 'run_mission',
		job_type: 'intake',
		state: 'succeeded',
		parent_job_id: null,
		created_at: '2026-08-18T07:01:00.000Z',
		updated_at: '2026-08-18T07:01:01.000Z',
	},
	{
		job_id: 'job_baseline',
		run_id: 'run_mission',
		job_type: 'baseline',
		state: 'succeeded',
		parent_job_id: null,
		created_at: '2026-08-18T07:01:01.000Z',
		updated_at: '2026-08-18T07:01:02.000Z',
	},
	{
		job_id: 'job_research',
		run_id: 'run_mission',
		job_type: 'research',
		state: 'succeeded',
		parent_job_id: null,
		created_at: '2026-08-18T07:01:02.000Z',
		updated_at: '2026-08-18T07:01:04.000Z',
	},
	{
		job_id: 'job_plan',
		run_id: 'run_mission',
		job_type: 'plan',
		state: 'succeeded',
		parent_job_id: null,
		created_at: '2026-08-18T07:01:04.000Z',
		updated_at: '2026-08-18T07:01:05.000Z',
	},
	{
		job_id: 'job_gate',
		run_id: 'run_mission',
		job_type: 'plan_gate',
		state: 'succeeded',
		parent_job_id: null,
		created_at: '2026-08-18T07:01:05.000Z',
		updated_at: '2026-08-18T07:01:06.000Z',
	},
	{
		job_id: 'job_build',
		run_id: 'run_mission',
		job_type: 'build',
		state: 'succeeded',
		parent_job_id: null,
		created_at: '2026-08-18T07:01:06.000Z',
		updated_at: '2026-08-18T07:01:09.000Z',
	},
	{
		job_id: 'job_verify',
		run_id: 'run_mission',
		job_type: 'verify',
		state: 'succeeded',
		parent_job_id: 'job_build',
		created_at: '2026-08-18T07:01:09.000Z',
		updated_at: '2026-08-18T07:01:10.000Z',
	},
	{
		job_id: 'job_review',
		run_id: 'run_mission',
		job_type: 'review',
		state: 'succeeded',
		parent_job_id: 'job_build',
		created_at: '2026-08-18T07:01:10.000Z',
		updated_at: '2026-08-18T07:01:13.000Z',
	},
];

const researchAttempts: ControlPlaneAttempt[] = [
	{
		attempt_id: 'att_r_code',
		run_id: 'run_mission',
		job_id: 'job_research',
		status: 'succeeded',
		input_contract: 'positron.research.v1',
		input_fingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
		output_contract: 'positron.research.v1',
		output_fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		worker_type: 'research-worker:code',
		provider: 'deterministic',
		model: 'research-v1',
		started_at: '2026-08-18T07:01:02.100Z',
		ended_at: '2026-08-18T07:01:03.400Z',
		failure_class: null,
		failure_signature: null,
		new_evidence: null,
		strategy_delta: null,
		result_ref: null,
	},
	{
		attempt_id: 'att_r_docs',
		run_id: 'run_mission',
		job_id: 'job_research',
		status: 'succeeded',
		input_contract: 'positron.research.v1',
		input_fingerprint: '2222222222222222222222222222222222222222222222222222222222222222',
		output_contract: 'positron.research.v1',
		output_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		worker_type: 'research-worker:docs',
		provider: 'deterministic',
		model: 'research-v1',
		started_at: '2026-08-18T07:01:02.200Z',
		ended_at: '2026-08-18T07:01:03.300Z',
		failure_class: null,
		failure_signature: null,
		new_evidence: null,
		strategy_delta: null,
		result_ref: null,
	},
	{
		attempt_id: 'att_r_tests',
		run_id: 'run_mission',
		job_id: 'job_research',
		status: 'succeeded',
		input_contract: 'positron.research.v1',
		input_fingerprint: '3333333333333333333333333333333333333333333333333333333333333333',
		output_contract: 'positron.research.v1',
		output_fingerprint: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
		worker_type: 'research-worker:tests',
		provider: 'deterministic',
		model: 'research-v1',
		started_at: '2026-08-18T07:01:02.300Z',
		ended_at: '2026-08-18T07:01:03.500Z',
		failure_class: null,
		failure_signature: null,
		new_evidence: null,
		strategy_delta: null,
		result_ref: null,
	},
];

const buildAttempts: ControlPlaneAttempt[] = [
	{
		attempt_id: 'att_b_1',
		run_id: 'run_mission',
		job_id: 'job_build',
		status: 'failed',
		input_contract: 'positron.build-input.v1',
		input_fingerprint: '4444444444444444444444444444444444444444444444444444444444444444',
		output_contract: 'positron.build-result.v1',
		output_fingerprint: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
		worker_type: 'opencode',
		provider: 'anthropic',
		model: 'claude-test',
		started_at: '2026-08-18T07:01:06.100Z',
		ended_at: '2026-08-18T07:01:07.000Z',
		failure_class: 'TEST_FAILURE',
		failure_signature: 'unit:sum.test.js',
		new_evidence: 'test output: assertion failed',
		strategy_delta: null,
		result_ref: null,
	},
	{
		attempt_id: 'att_b_2',
		run_id: 'run_mission',
		job_id: 'job_build',
		status: 'succeeded',
		input_contract: 'positron.build-input.v1',
		input_fingerprint: '5555555555555555555555555555555555555555555555555555555555555555',
		output_contract: 'positron.build-result.v1',
		output_fingerprint: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
		worker_type: 'opencode',
		provider: 'anthropic',
		model: 'claude-test',
		started_at: '2026-08-18T07:01:07.500Z',
		ended_at: '2026-08-18T07:01:08.500Z',
		failure_class: null,
		failure_signature: null,
		new_evidence: null,
		strategy_delta: 'Fix per verification evidence: changed parser boundary handling',
		result_ref: null,
	},
];

const verifyAttempts: ControlPlaneAttempt[] = [
	{
		attempt_id: 'att_v_1',
		run_id: 'run_mission',
		job_id: 'job_verify',
		status: 'succeeded',
		input_contract: 'positron.verification.v1',
		input_fingerprint: '6666666666666666666666666666666666666666666666666666666666666666',
		output_contract: 'positron.verification.v1',
		output_fingerprint: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
		worker_type: 'deterministic-tools',
		provider: null,
		model: null,
		started_at: '2026-08-18T07:01:09.000Z',
		ended_at: '2026-08-18T07:01:10.000Z',
		failure_class: null,
		failure_signature: null,
		new_evidence: null,
		strategy_delta: null,
		result_ref: null,
		checks: [{ name: 'npm test', passed: true, kind: 'unit' }],
	},
];

const reviewAttempts: ControlPlaneAttempt[] = [
	{
		attempt_id: 'att_rev_corr',
		run_id: 'run_mission',
		job_id: 'job_review',
		status: 'succeeded',
		input_contract: 'positron.review-batch.v1',
		input_fingerprint: '7777777777777777777777777777777777777777777777777777777777777777',
		output_contract: 'positron.finding.v1[]',
		output_fingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
		worker_type: 'review-worker:correctness',
		provider: null,
		model: null,
		started_at: '2026-08-18T07:01:10.100Z',
		ended_at: '2026-08-18T07:01:11.400Z',
		failure_class: null,
		failure_signature: null,
		new_evidence: null,
		strategy_delta: null,
		result_ref: null,
	},
	{
		attempt_id: 'att_rev_sec',
		run_id: 'run_mission',
		job_id: 'job_review',
		status: 'succeeded',
		input_contract: 'positron.review-batch.v1',
		input_fingerprint: '8888888888888888888888888888888888888888888888888888888888888888',
		output_contract: 'positron.finding.v1[]',
		output_fingerprint: '2222222222222222222222222222222222222222222222222222222222222222',
		worker_type: 'review-worker:security',
		provider: null,
		model: null,
		started_at: '2026-08-18T07:01:10.200Z',
		ended_at: '2026-08-18T07:01:11.300Z',
		failure_class: null,
		failure_signature: null,
		new_evidence: null,
		strategy_delta: null,
		result_ref: null,
	},
	{
		attempt_id: 'att_rev_qual',
		run_id: 'run_mission',
		job_id: 'job_review',
		status: 'succeeded',
		input_contract: 'positron.review-batch.v1',
		input_fingerprint: '9999999999999999999999999999999999999999999999999999999999999999',
		output_contract: 'positron.finding.v1[]',
		output_fingerprint: '3333333333333333333333333333333333333333333333333333333333333333',
		worker_type: 'review-worker:quality',
		provider: null,
		model: null,
		started_at: '2026-08-18T07:01:10.300Z',
		ended_at: '2026-08-18T07:01:11.500Z',
		failure_class: null,
		failure_signature: null,
		new_evidence: null,
		strategy_delta: null,
		result_ref: null,
	},
];

const decisions: ControlPlaneDecision[] = [
	{
		decision_id: 'dec_1',
		run_id: 'run_mission',
		decision: 'DONE',
		reason_code: 'ALL_HARD_GATES_GREEN',
		contract:
			'{"contract":"positron.decision.v1","run_id":"run_mission","decision":"DONE","reason_code":"ALL_HARD_GATES_GREEN","basis":{"research_parallelism":"PARALLELISM_PROVEN","parallelism":"PARALLELISM_PROVEN"}}',
		created_at: '2026-08-18T07:01:13.000Z',
	},
];

const transitions = [
	{
		transition_id: 'tr_1',
		run_id: 'run_mission',
		previous_state: 'INTAKE',
		new_state: 'INTAKE',
		reason_code: 'RUN_CREATED',
		created_at: '2026-08-18T07:01:00.000Z',
	},
	{
		transition_id: 'tr_2',
		run_id: 'run_mission',
		previous_state: 'INTAKE',
		new_state: 'BASELINE',
		reason_code: 'BASELINE_OK',
		created_at: '2026-08-18T07:01:01.000Z',
	},
	{
		transition_id: 'tr_3',
		run_id: 'run_mission',
		previous_state: 'BASELINE',
		new_state: 'RESEARCH',
		reason_code: 'RESEARCH_JOIN',
		created_at: '2026-08-18T07:01:04.000Z',
	},
	{
		transition_id: 'tr_4',
		run_id: 'run_mission',
		previous_state: 'RESEARCH',
		new_state: 'PLAN',
		reason_code: 'PLAN_OK',
		created_at: '2026-08-18T07:01:05.000Z',
	},
	{
		transition_id: 'tr_5',
		run_id: 'run_mission',
		previous_state: 'PLAN',
		new_state: 'PLAN_GATE',
		reason_code: 'PLAN_GATE_APPROVED',
		created_at: '2026-08-18T07:01:06.000Z',
	},
	{
		transition_id: 'tr_6',
		run_id: 'run_mission',
		previous_state: 'PLAN_GATE',
		new_state: 'BUILD',
		reason_code: 'BUILD_OK',
		created_at: '2026-08-18T07:01:09.000Z',
	},
	{
		transition_id: 'tr_7',
		run_id: 'run_mission',
		previous_state: 'BUILD',
		new_state: 'VERIFY',
		reason_code: 'VERIFY_PASS',
		created_at: '2026-08-18T07:01:10.000Z',
	},
	{
		transition_id: 'tr_8',
		run_id: 'run_mission',
		previous_state: 'VERIFY',
		new_state: 'REVIEW',
		reason_code: 'REVIEW_PARALLEL',
		created_at: '2026-08-18T07:01:13.000Z',
	},
	{
		transition_id: 'tr_9',
		run_id: 'run_mission',
		previous_state: 'REVIEW',
		new_state: 'DECIDE',
		reason_code: 'ALL_HARD_GATES_GREEN',
		created_at: '2026-08-18T07:01:13.500Z',
	},
];

function makeFixture(overrides: Partial<ControlPlaneResponse> = {}): ControlPlaneResponse {
	return {
		run_id: 'run_mission',
		jobs,
		attempts: [...researchAttempts, ...buildAttempts, ...verifyAttempts, ...reviewAttempts],
		decisions,
		transitions,
		...overrides,
	};
}

vi.mock('../api.js', () => ({
	api: {
		getControlPlane: vi.fn(),
		getKpis: vi.fn().mockResolvedValue({
			kpis: {
				runs_total: 0,
				done_runs: 0,
				first_pass_success_rate: null,
				mean_attempts_to_done: null,
				blind_retry_rate: 0,
				retry_denials: 0,
				duplicate_mutation_rate: 0,
				contract_validation_failure_rate: null,
				plan_gate_rejection_rate: null,
				security_block_enforcement_rate: null,
				useful_retry_rate: null,
				trace_completeness: null,
				p50_stage_duration_ms: null,
				p95_stage_duration_ms: null,
			},
			invariants: { violations: [] },
		}),
	},
}));

import { api } from '../api.js';

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.getControlPlane).mockResolvedValue(makeFixture());
});

describe('ACTIVE_RUN_LOADS_REAL_BACKEND_DATA', () => {
	test('lädt und projiziert echte Backend-Control-Plane-Daten', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		await waitFor(() => {
			expect(api.getControlPlane).toHaveBeenCalledWith('run_mission');
		});
		const panel = await screen.findByTestId('mission-control');
		expect(within(panel).getByText('Mission Control')).toBeInTheDocument();
		// run_id aus Backend-Daten (kein clientseitiger Default)
		expect(within(panel).getAllByText('run_mission').length).toBeGreaterThan(0);
	});
});

describe('ACTIVE_RUN_STATE', () => {
	test('zeigt aktuellen Job, Job-State und Attempt-Anzahl aus Backend-Daten', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		// Run-Section isolieren (Backend-Projection: current job = review, 3 Attempts)
		const runSection = within(panel).getByText('Run').closest('div')!;
		await waitFor(() => {
			expect(within(runSection).getByText('review')).toBeInTheDocument();
		});
		expect(within(runSection).getByText('SUCCEEDED')).toBeInTheDocument();
		expect(within(runSection).getByText('3')).toBeInTheDocument();
	});
});

describe('ACTIVE_RUN_TIMELINE', () => {
	test('rendert die persistierte Run Timeline (Transitions)', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		const timeline = within(panel).getByText('Run Timeline').closest('div')!;
		await waitFor(() => {
			expect(within(timeline).getByText('RESEARCH_JOIN')).toBeInTheDocument();
		});
		expect(within(timeline).getByText('PLAN_GATE_APPROVED')).toBeInTheDocument();
		expect(within(timeline).getByText('VERIFY_PASS')).toBeInTheDocument();
		expect(within(timeline).getByText('ALL_HARD_GATES_GREEN')).toBeInTheDocument();
	});
});

describe('ACTIVE_RUN_ATTEMPTS', () => {
	test('zeigt Attempt-Historie: Attempt 1 FAILED, Attempt 2 SUCCEEDED mit Strategy Delta', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		// Build-Attempt-Historie isolieren (alte Attempts verschwinden nicht)
		const buildHistory = within(panel).getByText('Attempt History (Build)').closest('div')!;
		await waitFor(() => {
			expect(within(buildHistory).getByText('Attempt 1')).toBeInTheDocument();
		});
		expect(within(buildHistory).getByText('Attempt 2')).toBeInTheDocument();
		expect(within(buildHistory).getByText('FAILED')).toBeInTheDocument();
		expect(within(buildHistory).getByText('SUCCEEDED')).toBeInTheDocument();
		// Failure Class + Strategy Delta aus Backend-Daten
		expect(within(buildHistory).getByText('TEST_FAILURE')).toBeInTheDocument();
		expect(within(buildHistory).getByText(/changed parser boundary handling/)).toBeInTheDocument();
	});
});

describe('ACTIVE_RUN_PLAN_GATE', () => {
	test('zeigt Plan-Gate-Verdict aus der persistierten Transition', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		const gateSection = within(panel).getByText('Plan Gate').closest('div')!;
		await waitFor(() => {
			expect(within(gateSection).getByText('PLAN_GATE_APPROVED')).toBeInTheDocument();
		});
		expect(within(gateSection).getByText('SUCCEEDED')).toBeInTheDocument();
	});
});

describe('ACTIVE_RUN_RESEARCH', () => {
	test('zeigt Research-Worker-Status (code/docs/tests) und Parallelismus-Verdict', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		const researchSection = within(panel).getByText('Research').closest('div')!;
		await waitFor(() => {
			expect(within(researchSection).getByText('code')).toBeInTheDocument();
		});
		expect(within(researchSection).getByText('docs')).toBeInTheDocument();
		expect(within(researchSection).getByText('tests')).toBeInTheDocument();
		// Verdict aus der persistierten Decision-Basis (kein clientseitiges Urteil)
		expect(within(researchSection).getByText('PARALLELISM_PROVEN')).toBeInTheDocument();
	});
});

describe('ACTIVE_RUN_REVIEW', () => {
	test('zeigt Review-Worker (correctness/security/quality) und Verdict', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		const reviewSection = within(panel).getByText('Reviews').closest('div')!;
		await waitFor(() => {
			expect(within(reviewSection).getByText('correctness')).toBeInTheDocument();
		});
		expect(within(reviewSection).getByText('security')).toBeInTheDocument();
		expect(within(reviewSection).getByText('quality')).toBeInTheDocument();
		// Review-Verdict (basis.parallelism aus P1)
		expect(within(reviewSection).getByText('PARALLELISM_PROVEN')).toBeInTheDocument();
	});
});

describe('ACTIVE_RUN_VERIFY', () => {
	test('zeigt strukturierte Verify-Gate-Checks aus dem Backend-Feld checks', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		const verifySection = within(panel).getByText('Verify').closest('div')!;
		await waitFor(() => {
			expect(within(verifySection).getByText('npm test')).toBeInTheDocument();
		});
		expect(within(verifySection).getByText('PASS')).toBeInTheDocument();
	});
});

describe('ACTIVE_RUN_DECISION', () => {
	test('zeigt deterministische Decision mit reason_code', async () => {
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		const decisionSection = within(panel).getByText('Decision').closest('div')!;
		await waitFor(() => {
			expect(within(decisionSection).getByText('DONE')).toBeInTheDocument();
		});
		expect(within(decisionSection).getByText('ALL_HARD_GATES_GREEN')).toBeInTheDocument();
	});
});

describe('ACTIVE_RUN_SECURITY_BLOCK', () => {
	test('zeigt Security Hard Block prominent an (BLOCKED, reason_code=SECURITY_BLOCK)', async () => {
		vi.mocked(api.getControlPlane).mockResolvedValue(
			makeFixture({
				decisions: [
					{
						decision_id: 'dec_sec',
						run_id: 'run_mission',
						decision: 'BLOCKED',
						reason_code: 'SECURITY_BLOCK',
						contract:
							'{"contract":"positron.decision.v1","run_id":"run_mission","decision":"BLOCKED","reason_code":"SECURITY_BLOCK","basis":{"blocking_findings":[{"severity":"CRITICAL","rule":"hardcoded-secret"}]}}',
						created_at: '2026-08-18T07:01:13.000Z',
					},
				],
			}),
		);
		render(<MissionControlPanel runId="run_mission" />);
		const banner = await screen.findByTestId('security-block-banner');
		expect(banner).toBeInTheDocument();
		expect(within(banner).getByText(/SECURITY HARD BLOCK/)).toBeInTheDocument();
		expect(within(banner).getByText(/SECURITY_BLOCK/)).toBeInTheDocument();
		const panel = screen.getByTestId('mission-control');
		expect(within(panel).getByText('BLOCKED')).toBeInTheDocument();
	});
});

describe('OLD_RUN_COMPATIBILITY', () => {
	test('alter Run ohne P2-Felder: abwärtskompatible Projection ohne Crash', async () => {
		vi.mocked(api.getControlPlane).mockResolvedValue({
			run_id: 'run_old',
			jobs: [],
			attempts: [],
			decisions: [],
			transitions: [],
		});
		render(<MissionControlPanel runId="run_old" />);
		const panel = await screen.findByTestId('mission-control');
		expect(within(panel).getAllByText('run_old').length).toBeGreaterThan(0);
		// Keine erfundenen Zustände — ehrliche Leerhinweise
		expect(within(panel).getByText('No decision recorded yet.')).toBeInTheDocument();
		expect(within(panel).getByText('No research job recorded.')).toBeInTheDocument();
		expect(within(panel).getByText('No persisted transitions yet.')).toBeInTheDocument();
	});

	test('nicht gefundener Run: kontrollierter Hinweis statt Absturz', async () => {
		vi.mocked(api.getControlPlane).mockRejectedValue(new Error('not found'));
		render(<MissionControlPanel runId="run_missing" />);
		expect(
			await screen.findByText(/Control-plane state unavailable for this run/),
		).toBeInTheDocument();
	});

	test('Backend nicht erreichbar: kontrollierte Fehlermeldung', async () => {
		vi.mocked(api.getControlPlane).mockRejectedValue(new Error('ECONNREFUSED'));
		render(<MissionControlPanel runId="run_down" />);
		expect(await screen.findByText(/Backend temporarily unavailable/)).toBeInTheDocument();
	});
});

describe('SENSITIVE_DATA_NOT_RENDERED', () => {
	test('rendert weder raw Payloads, noch Secrets, Tokens oder env-Inhalte', async () => {
		// Fixture mit absichtlich präparierten sensiblen Inhalten
		vi.mocked(api.getControlPlane).mockResolvedValue(
			makeFixture({
				attempts: [
					{
						attempt_id: 'att_leak',
						run_id: 'run_mission',
						job_id: 'job_build',
						status: 'failed',
						input_contract: 'positron.build-input.v1',
						input_fingerprint: '4444444444444444444444444444444444444444444444444444444444444444',
						output_contract: null,
						output_fingerprint: null,
						worker_type: 'opencode',
						provider: 'anthropic',
						model: 'claude-test',
						started_at: '2026-08-18T07:01:06.100Z',
						ended_at: '2026-08-18T07:01:07.000Z',
						failure_class: 'TEST_FAILURE',
						failure_signature:
							'build-error: rate limit exceeded token=abc123def456ghi789 Authorization Bearer sk-abcdefghijklmnopqrstuvwxyz1234567890',
						new_evidence: null,
						strategy_delta: 'Fix per verification evidence: password=hunter2 secret=correcthorse',
						result_ref: null,
					},
				],
			}),
		);
		render(<MissionControlPanel runId="run_mission" />);
		const panel = await screen.findByTestId('mission-control');
		await waitFor(() => {
			expect(within(panel).getByText('Attempt 1')).toBeInTheDocument();
		});
		const html = panel.innerHTML;
		// Raw Payloads werden NIE gerendert (Server exponiert kein output_json)
		expect(html).not.toContain('API_KEY=super-secret-value-123');
		expect(html).not.toContain('gh1234567890abcdefghijklm');
		// Secrets in Freitext-Feldern werden redacted
		expect(html).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890');
		expect(html).not.toContain('hunter2');
		expect(html).not.toContain('correcthorse');
		expect(html).not.toContain('token=abc123def456ghi789');
		// Redaction-Marker sind sichtbar (ehrliche Anzeige)
		expect(html).toContain('[redacted]');
	});
});
