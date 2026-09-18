// Positron Web — KPI Betriebsansicht (P2)
//
// Projektion von GET /api/kpis — keine clientseitige Berechnung.
// Harte Invarianten werden NICHT kosmetisch grün dargestellt: Verletzungen
// erscheinen rot und explizit.

import type React from 'react';
import { useEffect, useState } from 'react';
import type { KpiReport, KpisResponse } from '../../api.js';
import { api } from '../../api.js';
import { t } from '../../i18n/index.js';
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

function invariantOk(
	report: KpiReport,
	key: 'blind_retry_rate' | 'duplicate_mutation_rate',
): boolean {
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
				<h3 className="text-sm font-medium text-slate-300 mb-2">{t('Runtime KPIs')}</h3>
				<p className="text-xs text-slate-500">{t('Loading KPIs…')}</p>
			</div>
		);
	}

	if (state.kind === 'error') {
		return (
			<div className="card border-yellow-800">
				<h3 className="text-sm font-medium text-slate-300 mb-2">{t('Runtime KPIs')}</h3>
		<p className="text-xs text-yellow-300">{t('Backend temporarily unavailable:')} {state.message}</p>
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
				<h3 className="text-sm font-medium text-slate-300">{t('Runtime KPIs')}</h3>
				<span className="text-[10px] text-slate-600">{kpis.runs_total} {t('runs')}</span>
			</div>

			{invariants.violations.length > 0 && (
				<div
					className="mb-3 p-2 rounded-md border border-red-700 bg-red-900/40"
					data-testid="kpi-invariant-violation"
				>
					<p className="text-[11px] font-bold text-red-300">{t('INVARIANT VIOLATION')}</p>
					<ul className="list-disc ml-4 text-[11px] text-red-300/90">
						{invariants.violations.map((v) => (
							<li key={v}>{v}</li>
						))}
					</ul>
				</div>
			)}

			<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
				<KpiCell label={t('First-Pass Success')} value={formatRate(kpis.first_pass_success_rate)} />
				<KpiCell label={t('Mean Attempts to DONE')} value={formatCount(kpis.mean_attempts_to_done)} />
				<KpiCell
					label={t('Blind Retry Rate')}
					value={formatRate(kpis.blind_retry_rate)}
					ok={blindRetryOk}
					detail={blindRetryOk ? t('invariant: = 0') : t('INVARIANT VIOLATED')}
				/>
				<KpiCell
					label={t('Duplicate Mutation Rate')}
					value={formatRate(kpis.duplicate_mutation_rate)}
					ok={duplicateMutationOk}
					detail={duplicateMutationOk ? t('invariant: = 0') : t('INVARIANT VIOLATED')}
				/>
				<KpiCell label={t('Useful Retry Rate')} value={formatRate(kpis.useful_retry_rate)} />
				<KpiCell
					label={t('Security Enforcement')}
					value={formatRate(kpis.security_block_enforcement_rate)}
					ok={securityOk}
					detail={securityOk ? t('invariant: = 100 %') : t('INVARIANT VIOLATED')}
				/>
				<KpiCell label={t('Trace Completeness')} value={formatRate(kpis.trace_completeness)} />
				<KpiCell label={t('Retry Denials')} value={String(kpis.retry_denials)} />
				<KpiCell label={t('p50 Stage Duration')} value={formatDurationMs(kpis.p50_stage_duration_ms)} />
				<KpiCell label={t('p95 Stage Duration')} value={formatDurationMs(kpis.p95_stage_duration_ms)} />
			</div>

			{/* P5.1 — Harness Profile KPIs (Backend Truth, keine Client-Berechnung) */}
			<div className="mt-4" data-testid="profile-kpi-panel">
				<div className="flex items-center justify-between mb-2">
					<h4 className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
						{t('Profile KPIs')}
					</h4>
					<span className="text-[10px] text-slate-600">
						{t('cost/verified success:')}{' '}
						{state.data.profile?.cost_per_verified_success ?? 'NOT_AVAILABLE'}
					</span>
				</div>
				{!state.data.profile || state.data.profile.groups.length === 0 ? (
					<p className="text-xs text-slate-500">{t('No profile data yet.')}</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-[11px]">
							<thead>
								<tr className="text-left text-slate-500">
								<th className="py-1 pr-2 font-medium">{t('Profile')}</th>
								<th className="py-1 pr-2 font-medium">{t('Task')}</th>
								<th className="py-1 pr-2 font-medium text-right">{t('Sample')}</th>
								<th className="py-1 pr-2 font-medium text-right">{t('Verified Success')}</th>
								<th className="py-1 pr-2 font-medium text-right">{t('First Pass')}</th>
								<th className="py-1 pr-2 font-medium text-right">{t('Attempts/Success')}</th>
								<th className="py-1 pr-2 font-medium text-right">{t('Retry')}</th>
								</tr>
							</thead>
							<tbody>
								{state.data.profile.groups.map((g) => (
									<tr
										key={g.effective_harness_fingerprint}
										className="border-t border-slate-800/60"
									>
										<td className="py-1 pr-2 font-mono text-slate-300">
											{g.harness_profile_id ?? 'LEGACY_PROFILE_UNSPECIFIED'}
											{g.harness_profile_version ? (
												<span className="text-slate-500"> @{g.harness_profile_version}</span>
											) : null}
										</td>
										<td className="py-1 pr-2 text-slate-400">
											{g.task_profile_id ?? '—'}
											{g.task_type ? (
												<span className="text-slate-600"> ({g.task_type})</span>
											) : null}
										</td>
										<td className="py-1 pr-2 text-right text-slate-300">{g.sample_size}</td>
										<td className="py-1 pr-2 text-right text-slate-300">
											{formatRate(g.verified_success_rate)}
										</td>
										<td className="py-1 pr-2 text-right text-slate-300">
											{formatRate(g.first_pass_success_rate)}
										</td>
										<td className="py-1 pr-2 text-right text-slate-300">
											{formatCount(g.attempts_per_verified_success)}
										</td>
										<td className="py-1 pr-2 text-right text-slate-300">
											{formatRate(g.retry_rate)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
