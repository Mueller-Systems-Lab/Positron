import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import type { Run } from '../../types.js';

const PHASES = [
	'all',
	'ingest',
	'specify',
	'plan',
	'tasks',
	'implement',
	'review',
	'fix',
	'done',
	'failed',
	'cancelled',
] as const;

const STATUS_COLORS: Record<string, string> = {
	active: 'text-sky-600 dark:text-sky-400 bg-sky-500/10',
	done: 'text-green-600 dark:text-green-400 bg-green-500/10',
	failed: 'text-red-600 dark:text-red-400 bg-red-500/10',
	blocked: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
	cancelled: 'text-slate-600 dark:text-slate-400 bg-slate-500/10',
};

const STATUS_BG: Record<string, string> = {
	active: 'bg-sky-500',
	done: 'bg-green-500',
	failed: 'bg-red-500',
	blocked: 'bg-amber-500',
	cancelled: 'bg-slate-400',
};

function formatDuration(startedAt: string, finishedAt: string | null): string {
	const start = new Date(startedAt).getTime();
	const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
	const ms = end - start;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
	const m = Math.floor(ms / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	return `${m}m ${s}s`;
}

function timeAgo(dateStr: string): string {
	const ms = Date.now() - new Date(dateStr).getTime();
	if (ms < 60000) return 'just now';
	if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
	if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
	return `${Math.floor(ms / 86400000)}d ago`;
}

/** Fixed-size skeleton slot keys — stateless visual placeholders only. */
const RUNS_PAGE_SKELETON_SLOTS = [
	'runs-page-skeleton-1',
	'runs-page-skeleton-2',
	'runs-page-skeleton-3',
	'runs-page-skeleton-4',
	'runs-page-skeleton-5',
	'runs-page-skeleton-6',
	'runs-page-skeleton-7',
	'runs-page-skeleton-8',
] as const;

export default function RunsPage(): React.ReactElement {
	const [runs, setRuns] = useState<Run[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState('');
	const [phaseFilter, setPhaseFilter] = useState('all');
	const [statusFilter, setStatusFilter] = useState('all');

	const fetchRuns = useCallback(async () => {
		try {
			const data = await api.getRuns({ limit: 100 });
			setRuns(data.runs);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load runs');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchRuns();
		const interval = setInterval(fetchRuns, 10_000);
		return () => clearInterval(interval);
	}, [fetchRuns]);

	const filtered = useMemo(() => {
		return runs.filter((r) => {
			if (statusFilter !== 'all' && r.status !== statusFilter) return false;
			if (phaseFilter !== 'all' && r.phase !== phaseFilter) return false;
			if (searchTerm) {
				const q = searchTerm.toLowerCase();
				if (!r.id.toLowerCase().includes(q) && !(r.issueNumber?.toString() ?? '').includes(q))
					return false;
			}
			return true;
		});
	}, [runs, searchTerm, phaseFilter, statusFilter]);

	const statusCounts = useMemo(() => {
		const counts: Record<string, number> = {
			active: 0,
			done: 0,
			failed: 0,
			blocked: 0,
			cancelled: 0,
		};
		runs.forEach((r) => {
			counts[r.status] = (counts[r.status] ?? 0) + 1;
		});
		return counts;
	}, [runs]);

	if (loading) {
		return (
			<div>
				<div className="skeleton h-8 w-32 mb-2" />
				<div className="skeleton h-4 w-56 mb-6" />
				<div className="space-y-2">
					{RUNS_PAGE_SKELETON_SLOTS.map((slotKey) => (
						<div key={slotKey} className="skeleton h-10 w-full rounded" />
					))}
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div>
				<h1>Runs</h1>
				<div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mt-4">
					<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
					<button
						type="button"
						onClick={fetchRuns}
						className="text-xs mt-2 text-red-600 dark:text-red-400 hover:underline"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	return (
		<div>
			<div className="mb-6">
				<h1>Runs</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
					Agent execution runs across all repositories
				</p>
			</div>

			{/* Status Summary */}
			<div className="flex items-center gap-4 mb-4 text-xs">
				{Object.entries(statusCounts).map(([status, count]) => (
					<div key={status} className="flex items-center gap-1.5">
						<span className={`w-2 h-2 rounded-full ${STATUS_BG[status] ?? 'bg-slate-400'}`} />
						<span className="text-slate-500 dark:text-slate-400 capitalize">{status}</span>
						<span className="font-medium text-slate-700 dark:text-slate-300">{count}</span>
					</div>
				))}
			</div>

			{/* Filters */}
			<div className="flex items-center gap-3 mb-4 flex-wrap">
				<input
					type="text"
					placeholder="Search by ID, issue, repo..."
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
					className="input max-w-xs"
				/>
				<select
					value={phaseFilter}
					onChange={(e) => setPhaseFilter(e.target.value)}
					className="input max-w-[140px]"
				>
					{PHASES.map((p) => (
						<option key={p} value={p}>
							{p === 'all' ? 'All Phases' : p}
						</option>
					))}
				</select>
				<select
					value={statusFilter}
					onChange={(e) => setStatusFilter(e.target.value)}
					className="input max-w-[140px]"
				>
					<option value="all">All Status</option>
					<option value="active">Active</option>
					<option value="done">Done</option>
					<option value="failed">Failed</option>
					<option value="blocked">Blocked</option>
					<option value="cancelled">Cancelled</option>
				</select>
				{runs.length > 0 && (
					<span className="text-xs text-slate-500 dark:text-slate-400">
						{filtered.length} of {runs.length} runs
					</span>
				)}
			</div>

			{/* Empty States */}
			{runs.length === 0 && (
				<div className="card text-center py-12">
					<p className="text-4xl mb-3">🏃</p>
					<p className="text-sm text-slate-800 dark:text-slate-300 font-medium mb-1">No Runs Yet</p>
					<p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
						Start a run from the dashboard to see it here.
					</p>
					<Link to="/" className="btn-primary text-sm">
						Go to Dashboard
					</Link>
				</div>
			)}

			{runs.length > 0 && filtered.length === 0 && (
				<div className="card text-center py-8">
					<p className="text-4xl mb-2">🔎</p>
					<p className="text-sm text-slate-800 dark:text-slate-300 font-medium mb-1">
						No matching runs
					</p>
					<p className="text-xs text-slate-500 dark:text-slate-400">Try adjusting your filters.</p>
				</div>
			)}

			{/* Runs Table */}
			{filtered.length > 0 && (
				<div className="card p-0 overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
									<th className="text-left px-4 py-2 font-medium">Run ID</th>
									<th className="text-left px-4 py-2 font-medium">Phase</th>
									<th className="text-left px-4 py-2 font-medium">Status</th>
									<th className="text-left px-4 py-2 font-medium">Issue</th>
									<th className="text-left px-4 py-2 font-medium">Duration</th>
									<th className="text-left px-4 py-2 font-medium">Started</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200/50 dark:divide-slate-800/50">
								{filtered.map((run) => (
									<tr
										key={run.id}
										onClick={() => (window.location.href = `/runs/${run.id}`)}
										className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
									>
										<td className="px-4 py-2.5">
											<span className="text-xs font-mono text-slate-600 dark:text-slate-400">
												{run.id.slice(0, 12)}
											</span>
										</td>
										<td className="px-4 py-2.5">
											<span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
												{run.phase ?? '-'}
											</span>
										</td>
										<td className="px-4 py-2.5">
											<span
												className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_COLORS[run.status] ?? ''}`}
											>
												{run.status.toUpperCase()}
											</span>
										</td>
										<td className="px-4 py-2.5">
											<span className="text-xs text-slate-600 dark:text-slate-400">
												{run.issueNumber ? `#${run.issueNumber}` : '-'}
											</span>
										</td>
										<td className="px-4 py-2.5">
											<span className="text-xs text-slate-500 dark:text-slate-500">
												{formatDuration(run.startedAt, run.finishedAt)}
											</span>
										</td>
										<td className="px-4 py-2.5">
											<span className="text-[10px] text-slate-500 dark:text-slate-500">
												{timeAgo(run.startedAt)}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}
