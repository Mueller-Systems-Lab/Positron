// Positron Web — KPI Betriebsansicht Tests (P2)
//
// Verifiziert die Projektion von GET /api/kpis: Werte werden gerendert,
// Invarianten-Verletzungen werden NICHT kosmetisch grün dargestellt.

import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { KpisResponse } from '../api.js';
import KpiPanel from '../components/mission/KpiPanel.js';

function makeKpis(overrides: Partial<KpisResponse> = {}): KpisResponse {
	return {
		kpis: {
			runs_total: 12,
			done_runs: 9,
			first_pass_success_rate: 0.6667,
			mean_attempts_to_done: 1.4,
			blind_retry_rate: 0,
			retry_denials: 1,
			duplicate_mutation_rate: 0,
			contract_validation_failure_rate: 0,
			plan_gate_rejection_rate: 0,
			security_block_enforcement_rate: 1,
			useful_retry_rate: 0.5,
			trace_completeness: 1,
			p50_stage_duration_ms: 2400,
			p95_stage_duration_ms: 9800,
		},
		invariants: { violations: [] },
		...overrides,
	};
}

vi.mock('../api.js', () => ({
	api: {
		getKpis: vi.fn(),
	},
}));

import { api } from '../api.js';

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.getKpis).mockResolvedValue(makeKpis());
});

describe('KPI_VIEW', () => {
	test('rendert KPI-Werte aus der Backend-API (echte Daten, keine Platzhalter)', async () => {
		render(<KpiPanel />);
		const panel = await screen.findByTestId('kpi-panel');
		await waitFor(() => {
			expect(within(panel).getByText('Runtime KPIs')).toBeInTheDocument();
		});
		// First-Pass Success: 0.6667 → 66.7 %
		expect(within(panel).getByText('66.7 %')).toBeInTheDocument();
		// Mean Attempts to DONE: 1.4
		expect(within(panel).getByText('1.40')).toBeInTheDocument();
		// Invarianten-Werte (blind retry + duplicate mutation = 0.0 %)
		expect(within(panel).getAllByText('0.0 %')).toHaveLength(2);
		// security enforcement + trace completeness = 100.0 %
		expect(within(panel).getAllByText('100.0 %')).toHaveLength(2);
		// p50/p95 (formatierte Dauern)
		expect(within(panel).getByText('2s')).toBeInTheDocument();
		expect(within(panel).getByText('9s')).toBeInTheDocument();
		// Runs-Zähler
		expect(within(panel).getByText('12 runs')).toBeInTheDocument();
	});

	test('Invarianten sind sichtbar als „= 0“-Hinweise wenn sie gelten', async () => {
		render(<KpiPanel />);
		const panel = await screen.findByTestId('kpi-panel');
		await waitFor(() => {
			expect(within(panel).getAllByText(/invariant: = 0/)).toHaveLength(2);
		});
		expect(within(panel).getByText(/invariant: = 100 %/)).toBeInTheDocument();
	});

	test('Invarianten sind sichtbar als „= 0“-Hinweise wenn sie gelten', async () => {
		render(<KpiPanel />);
		const panel = await screen.findByTestId('kpi-panel');
		await waitFor(() => {
			expect(within(panel).getAllByText(/invariant: = 0/)).toHaveLength(2);
		});
		expect(within(panel).getByText(/invariant: = 100 %/)).toBeInTheDocument();
		expect(within(panel).getByText(/invariant: = 100 %/)).toBeInTheDocument();
	});
});

describe('KPI_INVARIANTS', () => {
	test('verletzte Invariante wird explizit rot angezeigt (kein kosmetisches Grün)', async () => {
		vi.mocked(api.getKpis).mockResolvedValue(
			makeKpis({
				kpis: {
					runs_total: 12,
					done_runs: 9,
					first_pass_success_rate: 0.5,
					mean_attempts_to_done: 1.8,
					blind_retry_rate: 0.25,
					retry_denials: 0,
					duplicate_mutation_rate: 0.1,
					contract_validation_failure_rate: 0,
					plan_gate_rejection_rate: 0,
					security_block_enforcement_rate: 0.5,
					useful_retry_rate: 0.5,
					trace_completeness: 1,
					p50_stage_duration_ms: 2400,
					p95_stage_duration_ms: 9800,
				},
				invariants: {
					violations: [
						'blind_retry_rate expected 0, got 0.25',
						'duplicate_mutation_rate expected 0, got 0.1',
						'security_block_enforcement_rate expected 1, got 0.5',
					],
				},
			}),
		);
		render(<KpiPanel />);
		const panel = await screen.findByTestId('kpi-panel');
		const violationBox = await screen.findByTestId('kpi-invariant-violation');
		expect(violationBox).toBeInTheDocument();
		expect(within(violationBox).getByText('INVARIANT VIOLATION')).toBeInTheDocument();
		expect(
			within(violationBox).getByText('blind_retry_rate expected 0, got 0.25'),
		).toBeInTheDocument();
		// Betroffene Zellen sind nicht grün, sondern als verletzt markiert
		const blindRetryCell = within(panel).getByText('Blind Retry Rate').closest('div')!;
		expect(within(blindRetryCell).getByText('INVARIANT VIOLATED')).toBeInTheDocument();
		const dupCell = within(panel).getByText('Duplicate Mutation Rate').closest('div')!;
		expect(within(dupCell).getByText('INVARIANT VIOLATED')).toBeInTheDocument();
		const secCell = within(panel).getByText('Security Enforcement').closest('div')!;
		expect(within(secCell).getByText('INVARIANT VIOLATED')).toBeInTheDocument();
	});

	test('Backend nicht erreichbar: kontrollierter Fehlerzustand', async () => {
		vi.mocked(api.getKpis).mockRejectedValue(new Error('ECONNREFUSED'));
		render(<KpiPanel />);
		expect(await screen.findByText(/Backend temporarily unavailable/)).toBeInTheDocument();
	});
});
