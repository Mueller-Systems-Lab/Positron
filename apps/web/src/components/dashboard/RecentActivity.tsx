import type React from 'react';
import { Link } from 'react-router-dom';
import type { Run } from '../../types.js';

/** Fixed-size skeleton slot keys — stateless visual placeholders only. */
const RECENT_ACTIVITY_SKELETON_SLOTS = [
	'recent-activity-skeleton-1',
	'recent-activity-skeleton-2',
	'recent-activity-skeleton-3',
	'recent-activity-skeleton-4',
] as const;

interface RecentActivityProps {
	runs: Run[];
	isLoading: boolean;
}

const STATUS_BADGE: Record<string, string> = {
	active: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
	done: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30',
	failed: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
	blocked: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
	cancelled: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
};

export default function RecentActivity({
	runs,
	isLoading,
}: RecentActivityProps): React.ReactElement {
	if (isLoading) {
		return (
			<div className="card animate-pulse">
				<div className="skeleton h-5 w-28 mb-3 rounded" />
				<div className="space-y-3">
					{RECENT_ACTIVITY_SKELETON_SLOTS.map((slotKey) => (
						<div key={slotKey} className="flex gap-3">
							<div className="skeleton h-8 w-8 rounded-full" />
							<div className="flex-1 space-y-1">
								<div className="skeleton h-3 w-3/4 rounded" />
								<div className="skeleton h-3 w-1/2 rounded" />
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	const recent = [...runs]
		.sort((a, b) => {
			const dateA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
			const dateB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
			return dateB - dateA;
		})
		.slice(0, 5);

	if (recent.length === 0) {
		return (
			<div className="card">
				<h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
					Recent Activity
				</h3>
				<p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
					No recent activity
				</p>
			</div>
		);
	}

	return (
		<div className="card">
			<h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
				Recent Activity
			</h3>
			<div className="space-y-1">
				{recent.map((run) => (
					<Link
						key={run.id}
						to={`/runs/${run.id}`}
						className="flex items-center gap-3 px-2 py-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
					>
						<div
							className={`w-2 h-2 rounded-full ${
								run.status === 'active'
									? 'bg-sky-500 animate-pulse'
									: run.status === 'done'
										? 'bg-green-500'
										: run.status === 'failed'
											? 'bg-red-500'
											: run.status === 'blocked'
												? 'bg-amber-500'
												: 'bg-slate-400'
							}`}
						/>
						<div className="flex-1 min-w-0">
							<p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
								{run.issueNumber ? `Issue #${run.issueNumber}` : `Run ${run.id.slice(0, 8)}`}
							</p>
							<p className="text-[10px] text-slate-500 dark:text-slate-500">
								{run.phase ?? 'unknown'} ·{' '}
								{run.startedAt ? new Date(run.startedAt).toLocaleString() : 'recently'}
							</p>
						</div>
						<span
							className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${STATUS_BADGE[run.status] ?? ''}`}
						>
							{run.status.toUpperCase()}
						</span>
					</Link>
				))}
			</div>
			{runs.length > 5 && (
				<div className="mt-3 text-center">
					<Link to="/runs" className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline">
						View all {runs.length} runs →
					</Link>
				</div>
			)}
		</div>
	);
}
