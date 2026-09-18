import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import type { OperatorReadiness, OperatorReadinessCheck } from '../../types.js';
import { statusLabel, t } from '../../i18n/index.js';

const COMPONENTS = [
	'server',
	'database',
	'workspace',
	'git',
	'github',
	'opencode',
	'provider',
	'model',
	'repository',
	'security_policy',
	'runtime_budget',
	'approval_system',
] as const;
const labels: Record<string, string> = {
	opencode: 'OpenCode',
	security_policy: 'Sicherheitsrichtlinie',
	runtime_budget: 'Laufzeitbudget',
	approval_system: 'Genehmigungssystem',
};

function tone(status: string): string {
	return status.startsWith('READY')
		? 'text-emerald-600 dark:text-emerald-300'
		: status === 'BLOCKED'
			? 'text-red-600 dark:text-red-300'
			: status === 'UNAVAILABLE'
				? 'text-orange-600 dark:text-orange-300'
				: 'text-amber-600 dark:text-amber-300';
}

export default function ReadinessPage(): React.ReactElement {
	const [data, setData] = useState<OperatorReadiness | null>(null);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		try {
			setData(await api.getOperatorReadiness());
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : t('Readiness unavailable'));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	return (
		<div>
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1>{t('Operator Readiness')}</h1>
					<p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
						Prüfe, was Positron vor dem Start eines Laufs sicher ausführen kann.
					</p>
				</div>
				<button type="button" className="btn-secondary" onClick={load}>
					{t('Refresh checks')}
				</button>
			</div>
			{error && (
				<div
					role="alert"
					className="card border-red-300 text-red-700 dark:border-red-900 dark:text-red-300"
				>
					{error}
				</div>
			)}
			{data && (
				<>
					<div className="card mb-5 flex flex-wrap items-center justify-between gap-4">
						<div>
							<p className="text-xs uppercase tracking-widest text-slate-500">{t('Overall status')}</p>
							<p
								data-testid="readiness-overall"
								className={`mt-1 text-2xl font-semibold ${tone(data.overall_status)}`}
							>
								{statusLabel(data.overall_status)}
							</p>
						</div>
						<Link className="btn-primary" to={data.next_action.href}>
							{data.next_action.label} →
						</Link>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						{COMPONENTS.map((key) => {
							const item = data[key] as OperatorReadinessCheck | undefined;
							if (!item) return null;
							return (
								<section key={key} className="card" data-testid={`readiness-${key}`}>
									<div className="flex items-center justify-between gap-3">
										<h2 className="text-sm font-semibold">
											{labels[key] ?? key.replaceAll('_', ' ')}
										</h2>
										<span className={`text-xs font-bold ${tone(item.status)}`}>{statusLabel(item.status)}</span>
									</div>
									<p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
										{item.human_message}
									</p>
									<p className="mt-2 text-xs text-slate-500">
										{t('Reason')}: <code>{item.reason_code}</code>
									</p>
									<p className="mt-1 text-xs text-slate-500">{t('Next')}: {item.remediation_hint}</p>
									<p className="mt-2 text-[11px] text-slate-400">
										{t('Evidence')}: {item.evidence_ref} · {t('checked')} {item.last_checked_at}
									</p>
								</section>
							);
						})}
					</div>
				</>
			)}
		</div>
	);
}
