// Positron Web — KPI Betriebsansicht (P2)
//
// Projektion von GET /api/kpis — keine clientseitige Berechnung.
// Harte Invarianten werden NICHT kosmetisch grün dargestellt: Verletzungen
// erscheinen rot und explizit.

import type React from 'react';
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import type { KpiReport, KpisResponse } from '../../api.js';
import { formatDurationMs } from './mission-format.js';

const POLL_INTERVAL_MS = 10000;

type KpiState =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'ready'; data: KpisResponse };

function formatRate(value: number | null): string {
	if (value === null || value === undefined || Number.isNaN(value)) return '—';
	return `${(value * 100).toFixed(1)} %`;
}

function formatCount(value: number | null): string {
	if (value === null || value === undefined || Number.isNaN(value)) return '—';
	return value.toFixed(2);
}

function KpiCell({
	label,
	value,
	ok = true,
	detail,
}: {
	label: string;
	value: string;
	ok?: boolean;
	detail?: string;
}): React.ReactElement {
	return (
		<div
			className={`rounded-md border p-2 ${
				ok ? 'border-slate-800 bg-slate-900/40' : 'border-red-700 bg-red-900/40'
			}`}
		>
			<p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
			<p className={`text-sm font-mono mt-0.5 ${ok ? 'text-slate-200' : 'text-red-300 font-bold'}`}>
				{value}
			</p>
			{detail && <p className="text-[10px] text-slate-600 mt-0.5">{detail}</p>}
		</div>
	);
}

function invariantOk(report: KpiReport, key: 'blind_retry_rate' | 'duplicate_mutation_rate'): boolean {
	return report[key] === 0;
}

export default function KpiPanel(): React.ReactElement {
	const [state, setState] = useState<KpiState>({ kind: 'loading' });
	const [refreshTick, setRefreshTick] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const data = await api.getKpis();
				if (!cancelled) setState({ kind: 'ready', data });
			} catch (err) {
				if (cancelled) return;
				setState({
					kind: 'error',
					message: err instanceof Error ? err.message : 'Unknown error',
				});
			}
		};
		void load();
		const timer = setInterval(() => setRefreshTick((t) => t + 1), POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);

	useEffect(() => {
		if (refreshTick === 0) return;
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const data = await api.getKpis();
				if (!cancelled) setState({ kind: 'ready', data });
			} catch (err) {
				if (cancelled) return;
				setState((prev) =>
					prev.kind === 'ready'
						? prev
						: { kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' },
				);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [refreshTick]);

	if (state.kind === 'loading') {
		return (
			<div className="card">
				<h3 className="text-sm font-medium text-slate-300 mb-2">Runtime KPIs</h3>
				<p className="text-xs text-slate-500">Loading KPIs…</p>
			</div>
		);
	}

	if (state.kind === 'error') {
		return (
			<div className="card border-yellow-800">
				<h3 className="text-sm font-medium text-slate-300 mb-2">Runtime KPIs</h3>
				<p className="text-xs text-yellow-300">Backend temporarily unavailable: {state.message}</p>
			</div>
		);
	}

	const { kpis, invariants } = state.data;
	const blindRetryOk = invariantOk(kpis, 'blind_retry_rate');
	const duplicateMutationOk = invariantOk(kpis, 'duplicate_mutation_rate');
	const securityOk =
		kpis.security_block_enforcement_rate === null ||
		kpis.security_block_enforcement_rate === 1 ||
		kpis.security_block_enforcement_rate === 100;

	return (
		<div className="card" data-testid="kpi-panel">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-sm font-medium text-slate-300">Runtime KPIs</h3>
				<span className="text-[10px] text-slate-600">{kpis.runs_total} runs</span>
			</div>

			{invariants.violations.length > 0 && (
				<div className="mb-3 p-2 rounded-md border border-red-700 bg-red-900/40" data-testid="kpi-invariant-violation">
					<p className="text-[11px] font-bold text-red-300">INVARIANT VIOLATION</p>
					<ul className="list-disc ml-4 text-[11px] text-red-300/90">
						{invariants.violations.map((v) => (
							<li key={v}>{v}</li>
						))}
					</ul>
				</div>
			)}

			<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
				<KpiCell label="First-Pass Success" value={formatRate(kpis.first_pass_success_rate)} />
				<KpiCell label="Mean Attempts to DONE" value={formatCount(kpis.mean_attempts_to_done)} />
				<KpiCell
					label="Blind Retry Rate"
					value={formatRate(kpis.blind_retry_rate)}
					ok={blindRetryOk}
					detail={blindRetryOk ? 'invariant: = 0' : 'INVARIANT VIOLATED'}
				/>
				<KpiCell
					label="Duplicate Mutation Rate"
					value={formatRate(kpis.duplicate_mutation_rate)}
					ok={duplicateMutationOk}
					detail={duplicateMutationOk ? 'invariant: = 0' : 'INVARIANT VIOLATED'}
				/>
				<KpiCell label="Useful Retry Rate" value={formatRate(kpis.useful_retry_rate)} />
				<KpiCell
					label="Security Enforcement"
					value={formatRate(kpis.security_block_enforcement_rate)}
					ok={securityOk}
					detail={securityOk ? 'invariant: = 100 %' : 'INVARIANT VIOLATED'}
				/>
				<KpiCell label="Trace Completeness" value={formatRate(kpis.trace_completeness)} />
				<KpiCell label="Retry Denials" value={String(kpis.retry_denials)} />
				<KpiCell label="p50 Stage Duration" value={formatDurationMs(kpis.p50_stage_duration_ms)} />
				<KpiCell label="p95 Stage Duration" value={formatDurationMs(kpis.p95_stage_duration_ms)} />
			</div>
		</div>
	);
}
