import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import type { Phase, Run } from '../types.js';
import { ALL_PHASES } from '../types.js';
import PhaseBadge from './PhaseBadge.jsx';

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

function relativeTime(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return 'gerade eben';
	if (minutes < 60) return `vor ${minutes} Minuten`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `vor ${hours} Stunden`;
	return `vor ${Math.floor(hours / 24)} Tagen`;
}

export default function Dashboard(): React.ReactElement {
	const navigate = useNavigate();
	const [runs, setRuns] = useState<Run[]>([]);
	const [totalRuns, setTotalRuns] = useState(0);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [phaseFilter, setPhaseFilter] = useState<string>('all');
	const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
	const [selectedRepo, setSelectedRepo] = useState<string>('');
	const [issueNumber, setIssueNumber] = useState('');
	const [autonomyLevel, setAutonomyLevel] = useState(2);
	const [startingRun, setStartingRun] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successRate, setSuccessRate] = useState(0);

	const fetchRuns = useCallback(async () => {
		try {
			const data = await api.getRuns({ limit: 100 });
			setRuns(data.runs);
			setTotalRuns(data.total);
			const completed = data.runs.filter((r) => r.status === 'done' || r.phase === 'DONE');
			setSuccessRate(
				completed.length > 0
					? Math.round(
							(completed.filter((r) => r.phase === 'DONE').length / completed.length) * 100,
						)
					: 0,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load runs');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchRuns();
		const interval = setInterval(fetchRuns, 5000);
		return () => clearInterval(interval);
	}, [fetchRuns]);

	const filteredRuns = runs.filter((run) => {
		if (
			searchTerm &&
			!run.id.toLowerCase().includes(searchTerm.toLowerCase()) &&
			!String(run.issueNumber).includes(searchTerm)
		) {
			return false;
		}
		if (phaseFilter !== 'all' && run.phase !== phaseFilter) return false;
		return true;
	});

	const activeRuns = runs.filter((r) => r.status === 'active').length;

	const avgDurationMs =
		runs.length > 0
			? runs.reduce((sum, r) => {
					if (!r.finishedAt || !r.startedAt) return sum;
					return sum + (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime());
				}, 0) / runs.length
			: 0;

	async function handleStartRun(): Promise<void> {
		if (!selectedRepo || !issueNumber) return;
		setStartingRun(true);
		setError(null);
		try {
			const { run: startedRun } = await api.startRun(
				selectedRepo,
				Number.parseInt(issueNumber, 10),
				autonomyLevel,
			);
			setIsNewRunModalOpen(false);
			setIssueNumber('');
			navigate(`/runs/${startedRun.id}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to start run');
		} finally {
			setStartingRun(false);
		}
	}

	return (
		<div>
			{/* Header */}
			<div className="flex items-center justify-between mb-6">
				<div>
					<h1 className="text-2xl font-bold text-white">⚡ Positron Dashboard</h1>
					<p className="text-slate-400 text-sm mt-1">Evidence-Gated GitHub Issue Execution</p>
				</div>
				<button type="button" onClick={() => setIsNewRunModalOpen(true)} className="btn-primary">
					+ New Run
				</button>
			</div>

			{/* Error Banner */}
			{error && (
				<div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
					{error}
					<button
						type="button"
						onClick={() => setError(null)}
						className="ml-2 text-red-300 hover:text-red-100"
					>
						✕
					</button>
				</div>
			)}

			{/* Metrics Cards */}
			<div className="grid grid-cols-4 gap-4 mb-6">
				<div className="card">
					<p className="text-slate-400 text-xs uppercase tracking-wide">Total Runs</p>
					<p className="text-2xl font-bold text-white mt-1">{loading ? '...' : totalRuns}</p>
				</div>
				<div className="card">
					<p className="text-slate-400 text-xs uppercase tracking-wide">Success Rate</p>
					<p className="text-2xl font-bold text-green-400 mt-1">
						{loading ? '...' : `${successRate}%`}
					</p>
				</div>
				<div className="card">
					<p className="text-slate-400 text-xs uppercase tracking-wide">Active Runs</p>
					<p className="text-2xl font-bold text-blue-400 mt-1">{loading ? '...' : activeRuns}</p>
				</div>
				<div className="card">
					<p className="text-slate-400 text-xs uppercase tracking-wide">Avg. Time</p>
					<p className="text-2xl font-bold text-white mt-1">
						{loading ? '...' : formatDuration(avgDurationMs)}
					</p>
				</div>
			</div>

			{/* Filters */}
			<div className="flex items-center gap-3 mb-4">
				<input
					type="text"
					placeholder="Suche nach Run-ID oder Issue-Nr..."
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
					className="input max-w-xs"
				/>
				<select
					value={phaseFilter}
					onChange={(e) => setPhaseFilter(e.target.value)}
					className="input max-w-[200px]"
				>
					<option value="all">Alle Phasen</option>
					{ALL_PHASES.map((p) => (
						<option key={p} value={p}>
							{p}
						</option>
					))}
				</select>
			</div>

			{/* Runs Table */}
			{loading ? (
				<div className="card text-center py-12">
					<div className="animate-spin-slow inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
					<p className="text-slate-400 mt-3">Lade Runs...</p>
				</div>
			) : filteredRuns.length === 0 ? (
				<div className="card text-center py-12">
					<p className="text-4xl mb-3">📋</p>
					<p className="text-slate-400 text-lg">
						{runs.length === 0
							? 'Noch keine Runs — erstelle deinen ersten Run'
							: 'Keine Runs gefunden, die den Filtern entsprechen'}
					</p>
					{runs.length === 0 && (
						<button
							type="button"
							onClick={() => setIsNewRunModalOpen(true)}
							className="btn-primary mt-4"
						>
							Ersten Run erstellen
						</button>
					)}
				</div>
			) : (
				<div className="card p-0 overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
									<th className="text-left px-4 py-3 font-medium">ID</th>
									<th className="text-left px-4 py-3 font-medium">Phase</th>
									<th className="text-left px-4 py-3 font-medium">Status</th>
									<th className="text-left px-4 py-3 font-medium">Repository</th>
									<th className="text-left px-4 py-3 font-medium">Issue</th>
									<th className="text-left px-4 py-3 font-medium">Dauer</th>
									<th className="text-left px-4 py-3 font-medium">Gestartet</th>
									<th className="text-right px-4 py-3 font-medium">Aktionen</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-700">
								{filteredRuns.map((run) => {
									const duration =
										run.finishedAt && run.startedAt
											? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
											: 0;
									return (
										<tr key={run.id} className="hover:bg-slate-700/50 transition-colors">
											<td className="px-4 py-3 font-mono text-xs text-blue-400">
												<button
													type="button"
													onClick={() => navigate(`/runs/${run.id}`)}
													className="hover:underline"
												>
													{run.id.slice(0, 8)}
												</button>
											</td>
											<td className="px-4 py-3">
												<PhaseBadge phase={run.phase} size="xs" />
											</td>
											<td className="px-4 py-3">
												<span
													className={`text-xs font-medium ${
														run.status === 'active'
															? 'text-blue-400'
															: run.status === 'done'
																? 'text-green-400'
																: run.status === 'failed'
																	? 'text-red-400'
																	: 'text-slate-400'
													}`}
												>
													{run.status}
												</span>
											</td>
											<td className="px-4 py-3 text-slate-300 text-xs">{run.repoId}</td>
											<td className="px-4 py-3">
												<span className="text-blue-400 text-xs font-mono">#{run.issueNumber}</span>
											</td>
											<td className="px-4 py-3 text-slate-400 text-xs">
												{duration > 0 ? formatDuration(duration) : '-'}
											</td>
											<td className="px-4 py-3 text-slate-400 text-xs">
												{relativeTime(run.startedAt)}
											</td>
											<td className="px-4 py-3 text-right">
												<button
													type="button"
													onClick={() => navigate(`/runs/${run.id}`)}
													className="btn-secondary text-xs py-1 px-3"
												>
													Details
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* New Run Modal */}
			{isNewRunModalOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					<div
						className="absolute inset-0 bg-black/60 backdrop-blur-sm"
						onClick={() => setIsNewRunModalOpen(false)}
					/>
					<div className="relative bg-slate-800 rounded-2xl border border-slate-700 p-6 w-full max-w-md mx-4 shadow-2xl">
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-bold text-white">Neuen Run starten</h2>
							<button
								type="button"
								onClick={() => setIsNewRunModalOpen(false)}
								className="text-slate-400 hover:text-white text-xl"
							>
								✕
							</button>
						</div>

						<div className="space-y-4">
							<div>
								<label htmlFor="dashboard-repo" className="block text-sm text-slate-300 mb-1">
									Repository
								</label>
								<input
									id="dashboard-repo"
									type="text"
									placeholder="z.B. Positron"
									value={selectedRepo}
									onChange={(e) => setSelectedRepo(e.target.value)}
									className="input"
								/>
							</div>

							<div>
								<label htmlFor="dashboard-issue" className="block text-sm text-slate-300 mb-1">
									Issue-Nummer
								</label>
								<input
									id="dashboard-issue"
									type="number"
									min={1}
									placeholder="z.B. 42"
									value={issueNumber}
									onChange={(e) => setIssueNumber(e.target.value)}
									className="input"
								/>
							</div>

							<fieldset>
								<legend className="block text-sm text-slate-300 mb-2">Autonomie-Level</legend>
								<div className="flex gap-3">
									{[
										{ value: 0, label: 'Full' },
										{ value: 1, label: 'Semi' },
										{ value: 2, label: 'Manual' },
									].map((option) => (
										<label
											key={option.value}
											className={`flex-1 flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
												autonomyLevel === option.value
													? 'bg-blue-600 border-blue-500 text-white'
													: 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
											}`}
										>
											<input
												type="radio"
												name="autonomy"
												value={option.value}
												checked={autonomyLevel === option.value}
												onChange={() => setAutonomyLevel(option.value)}
												className="sr-only"
											/>
											{option.label}
										</label>
									))}
								</div>
							</fieldset>

							<button
								type="button"
								onClick={handleStartRun}
								disabled={!selectedRepo || !issueNumber || startingRun}
								className="btn-primary w-full"
							>
								{startingRun ? (
									<span className="flex items-center justify-center gap-2">
										<span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
										Starte...
									</span>
								) : (
									'▶ Run starten'
								)}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
