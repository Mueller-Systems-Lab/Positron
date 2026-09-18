import type React from 'react';
import { Link } from 'react-router-dom';
import type { Run } from '../../types.js';
import { statusLabel, t } from '../../i18n/index.js';

interface AttentionQueueProps {
	runs: Run[];
	isLoading: boolean;
}

const STATUS_COLORS: Record<string, string> = {
	active: 'text-sky-600 dark:text-sky-400 bg-sky-500/10',
	blocked: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
	failed: 'text-red-600 dark:text-red-400 bg-red-500/10',
	done: 'text-green-600 dark:text-green-400 bg-green-500/10',
	cancelled: 'text-slate-600 dark:text-slate-400 bg-slate-500/10',
};

export default function AttentionQueue({
	runs,
	isLoading,
}: AttentionQueueProps): React.ReactElement {
	const activeRuns = runs.filter((r) => r.status === 'active' || r.status === 'blocked');

	if (isLoading) {
		return (
			<div className="card animate-pulse">
				<div className="skeleton h-5 w-28 mb-3 rounded" />
				<div className="space-y-2">
					<div className="skeleton h-8 w-full rounded" />
					<div className="skeleton h-8 w-full rounded" />
				</div>
			</div>
		);
	}

	return (
		<div className="card">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
					{t('Attention Queue')}
				</h3>
				{activeRuns.length > 0 && (
					<span className="text-[10px] font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded">
						{activeRuns.length} {t('active')}
					</span>
				)}
			</div>
			{activeRuns.length === 0 ? (
				<p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
					{t('No Runs requiring attention')}
				</p>
			) : (
				<div className="space-y-1">
					{activeRuns.slice(0, 5).map((run) => (
						<Link
							key={run.id}
							to={`/runs/${run.id}`}
							className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
						>
							<span className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
								{run.id.slice(0, 12)}...
							</span>
							<span
								className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[run.status] ?? ''}`}
							>
								{statusLabel(run.status)}
							</span>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
