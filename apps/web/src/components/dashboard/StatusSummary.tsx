import type React from 'react';
import type { Metrics } from '../../types.js';

/** Fixed-size skeleton slot keys — stateless visual placeholders only. */
const STATUS_SUMMARY_SKELETON_SLOTS = [
	'status-summary-skeleton-1',
	'status-summary-skeleton-2',
	'status-summary-skeleton-3',
	'status-summary-skeleton-4',
] as const;

interface StatusSummaryProps {
	metrics: Metrics | null;
	isLoading: boolean;
}

export default function StatusSummary({
	metrics,
	isLoading,
}: StatusSummaryProps): React.ReactElement {
	if (isLoading) {
		return (
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
				{STATUS_SUMMARY_SKELETON_SLOTS.map((slotKey) => (
					<div key={slotKey} className="card animate-pulse">
						<div className="skeleton h-3 w-20 mb-2 rounded" />
						<div className="skeleton h-8 w-12 rounded" />
					</div>
				))}
			</div>
		);
	}

	const byStatus = metrics?.runsByStatus ?? {};
	const items = [
		{
			label: 'Active Runs',
			value: byStatus.active ?? 0,
			color: 'text-sky-600 dark:text-sky-400',
			border: 'border-l-sky-400',
		},
		{
			label: 'Completed',
			value: byStatus.done ?? 0,
			color: 'text-green-600 dark:text-green-400',
			border: 'border-l-green-400',
		},
		{
			label: 'Failed',
			value: byStatus.failed ?? 0,
			color: 'text-red-600 dark:text-red-400',
			border: 'border-l-red-400',
		},
		{
			label: 'Total Runs',
			value: metrics?.totalRuns ?? 0,
			color: 'text-slate-600 dark:text-slate-400',
			border: 'border-l-slate-400',
		},
	];

	return (
		<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
			{items.map((item) => (
				<div key={item.label} className={`card !border-l-4 ${item.border}`}>
					<p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
						{item.label}
					</p>
					<p className={`text-2xl font-bold mt-1 ${item.color}`}>{item.value}</p>
				</div>
			))}
		</div>
	);
}
