import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import EmptyState from '../shared/EmptyState.js';
import ErrorBanner from '../shared/ErrorBanner.js';
import LoadingSkeleton from '../shared/LoadingSkeleton.js';

interface EvidenceItem {
	id: string;
	type: string;
	kind: string;
	source: string;
	sourceId: string;
	status: 'pass' | 'fail' | 'partial';
	summary: string;
	timestamp: string;
	runPhase?: string;
}

const KIND_LABELS: Record<string, string> = {
	spec: 'Specification',
	plan: 'Implementation Plan',
	tasks: 'Task List',
	review: 'Code Review',
	'test-results': 'Test Results',
	diff: 'Code Diff',
	test: 'Test Run',
	implementation: 'Implementation',
	research: 'Research',
};

const KIND_COLORS: Record<string, string> = {
	spec: 'bg-violet-500/15 text-violet-400 border-violet-800',
	plan: 'bg-purple-500/15 text-purple-400 border-purple-800',
	tasks: 'bg-indigo-500/15 text-indigo-400 border-indigo-800',
	review: 'bg-orange-500/15 text-orange-400 border-orange-800',
	'test-results': 'bg-amber-500/15 text-amber-400 border-amber-800',
	diff: 'bg-cyan-500/15 text-cyan-400 border-cyan-800',
	test: 'bg-green-500/15 text-green-400 border-green-800',
	implementation: 'bg-sky-500/15 text-sky-400 border-sky-800',
	research: 'bg-pink-500/15 text-pink-400 border-pink-800',
};

export default function EvidencePage(): React.ReactElement {
	const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
	const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState<string>('all');
	const [typeFilter, setTypeFilter] = useState<string>('all');
	const [runFilter, setRunFilter] = useState<string>('all');
	const [runs, setRuns] = useState<Array<{ id: string; issueNumber: number }>>([]);
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const fetchEvidence = useCallback(async () => {
		try {
			const [evidenceData, runsData] = await Promise.all([
				api.getEvidence(),
				api.getRuns({ limit: 100 }).catch(() => ({ runs: [] })),
			]);
			if (evidenceData.evidence) setEvidence(evidenceData.evidence);
			else if (evidenceData.summary) {
				setSummary(evidenceData.summary);
				setEvidence([]);
			}
			setRuns(runsData.runs);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load evidence');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchEvidence();
	}, [fetchEvidence]);

	const filtered = useMemo(() => {
		return evidence.filter((e) => {
			if (statusFilter !== 'all' && e.status !== statusFilter) return false;
			if (typeFilter !== 'all' && e.type !== typeFilter) return false;
			if (runFilter !== 'all' && e.sourceId !== runFilter) return false;
			if (searchTerm) {
				const q = searchTerm.toLowerCase();
				if (
					!e.summary.toLowerCase().includes(q) &&
					!e.kind.toLowerCase().includes(q) &&
					!e.sourceId.toLowerCase().includes(q) &&
					!(KIND_LABELS[e.kind] ?? '').toLowerCase().includes(q)
				)
					return false;
			}
			return true;
		});
	}, [evidence, searchTerm, statusFilter, typeFilter, runFilter]);

	const types = useMemo(() => {
		const ts = new Set(evidence.map((e) => e.type));
		return ['all', ...Array.from(ts)];
	}, [evidence]);

	const runOptions = useMemo(() => {
		const runIds = new Set(evidence.map((e) => e.sourceId));
		return ['all', ...Array.from(runIds)];
	}, [evidence]);

	if (loading) {
		return (
			<div>
				<div className="skeleton h-8 w-48 mb-2" />
				<div className="skeleton h-4 w-72 mb-6" />
				<LoadingSkeleton variant="table" rows={5} />
			</div>
		);
	}

	if (error) {
		return (
			<div>
				<h1>Evidence</h1>
				<ErrorBanner message={error} onRetry={fetchEvidence} />
			</div>
		);
	}

	const noData = evidence.length === 0 && !summary;

	return (
		<div>
			<div className="mb-6">
				<h1>Evidence</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
					Aggregated evidence artifacts, test results, and logs across all runs
				</p>
			</div>

			{/* Summary Cards */}
			{summary && (
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
					<div className="card !border-l-green-400 !border-l-4 !bg-green-500/5">
						<p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
							Artifacts
						</p>
						<p className="text-2xl font-bold text-green-600 dark:text-green-400">
							{summary.totalArtifacts as number}
						</p>
						<p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
							{Object.entries((summary.artifactBreakdown as Record<string, number>) ?? {})
								.map(([k, v]) => `${k}: ${v}`)
								.join(', ')}
						</p>
					</div>
					<div className="card !border-l-sky-400 !border-l-4 !bg-sky-500/5">
						<p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
							Test Events
						</p>
						<p className="text-2xl font-bold text-sky-600 dark:text-sky-400">
							{summary.testEvents as number}
						</p>
					</div>
					<div className="card !border-l-red-400 !border-l-4 !bg-red-500/5">
						<p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
							Errors
						</p>
						<p className="text-2xl font-bold text-red-600 dark:text-red-400">
							{summary.errorEvents as number}
						</p>
					</div>
					<div className="card !border-l-amber-400 !border-l-4 !bg-amber-500/5">
						<p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
							Warnings
						</p>
						<p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
							{summary.warningEvents as number}
						</p>
					</div>
				</div>
			)}

			{/* Empty State */}
			{noData && (
				<EmptyState
					icon="🔍"
					title="No Evidence Yet"
					description="Evidence artifacts are generated when agent runs execute."
					action={{
						label: 'Start a Run',
						onClick: () => {
							window.location.href = '/';
						},
					}}
				/>
			)}

			{summary && evidence.length === 0 && (
				<div className="card text-center py-8 mt-4">
					<p className="text-2xl mb-2">📊</p>
					<p className="text-sm text-slate-800 dark:text-slate-300 font-medium mb-1">
						Evidence Summary Available
					</p>
					<p className="text-xs text-slate-500 dark:text-slate-500">
						Aggregated data is available, but no individual evidence items exist yet.
					</p>
				</div>
			)}

			{/* Filtered Empty */}
			{evidence.length > 0 && filtered.length === 0 && (
				<div className="card text-center py-8">
					<p className="text-4xl mb-2">🔎</p>
					<p className="text-sm text-slate-800 dark:text-slate-300 font-medium mb-1">
						No matching evidence
					</p>
					<p className="text-xs text-slate-500 dark:text-slate-500">Try adjusting your filters.</p>
				</div>
			)}

			{/* Filters + Evidence List */}
			{evidence.length > 0 && filtered.length > 0 && (
				<>
					<div className="flex items-center gap-3 mb-4 flex-wrap">
						<input
							type="text"
							placeholder="Search evidence..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="input max-w-xs"
						/>
						<select
							value={statusFilter}
							onChange={(e) => setStatusFilter(e.target.value)}
							className="input max-w-[130px]"
						>
							<option value="all">All Status</option>
							<option value="pass">Pass</option>
							<option value="fail">Fail</option>
							<option value="partial">Partial</option>
						</select>
						<select
							value={typeFilter}
							onChange={(e) => setTypeFilter(e.target.value)}
							className="input max-w-[130px]"
						>
							{types.map((t) => (
								<option key={t} value={t}>
									{t === 'all' ? 'All Types' : t}
								</option>
							))}
						</select>
						<select
							value={runFilter}
							onChange={(e) => setRunFilter(e.target.value)}
							className="input max-w-[180px]"
						>
							<option value="all">All Runs</option>
							{runOptions
								.filter((r) => r !== 'all')
								.map((r) => (
									<option key={r} value={r}>
										Run {r.slice(0, 8)}
									</option>
								))}
						</select>
						<span className="text-xs text-slate-500 dark:text-slate-400">
							{filtered.length} of {evidence.length} items
						</span>
					</div>

					<div className="card p-0 overflow-hidden">
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
										<th className="text-left px-4 py-2 font-medium">Kind</th>
										<th className="text-left px-4 py-2 font-medium">Status</th>
										<th className="text-left px-4 py-2 font-medium">Summary</th>
										<th className="text-left px-4 py-2 font-medium">Run</th>
										<th className="text-left px-4 py-2 font-medium">Time</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200/50 dark:divide-slate-800/50">
									{filtered.map((item) => (
										<React.Fragment key={item.id}>
											<tr
												onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
												className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
											>
												<td className="px-4 py-2.5">
													<span
														className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${KIND_COLORS[item.kind] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'}`}
													>
														{KIND_LABELS[item.kind] ?? item.kind}
													</span>
												</td>
												<td className="px-4 py-2.5">
													<span
														className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
															item.status === 'pass'
																? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400'
																: item.status === 'fail'
																	? 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400'
																	: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
														}`}
													>
														{item.status.toUpperCase()}
													</span>
												</td>
												<td className="px-4 py-2.5">
													<span className="text-xs text-slate-600 dark:text-slate-400 truncate max-w-[250px] block">
														{item.summary}
													</span>
												</td>
												<td className="px-4 py-2.5">
													<Link
														to={`/runs/${item.sourceId}`}
														onClick={(e) => e.stopPropagation()}
														className="text-[10px] font-mono text-sky-600 dark:text-sky-400 hover:underline"
													>
														{item.sourceId.slice(0, 8)}
													</Link>
												</td>
												<td className="px-4 py-2.5">
													<span className="text-[10px] text-slate-500 dark:text-slate-500">
														{new Date(item.timestamp).toLocaleString()}
													</span>
												</td>
											</tr>
											{expandedId === item.id && (
												<tr className="bg-slate-50 dark:bg-slate-800/20">
													<td colSpan={5} className="px-4 py-3">
														<div className="grid grid-cols-2 gap-3 text-xs">
															<div>
																<span className="text-slate-500 dark:text-slate-500 block">
																	Kind
																</span>
																<span className="text-slate-700 dark:text-slate-300 font-mono">
																	{item.kind}
																</span>
															</div>
															<div>
																<span className="text-slate-500 dark:text-slate-500 block">
																	Phase
																</span>
																<span className="text-slate-700 dark:text-slate-300">
																	{item.runPhase ?? '-'}
																</span>
															</div>
															<div>
																<span className="text-slate-500 dark:text-slate-500 block">
																	Source
																</span>
																<span className="text-slate-700 dark:text-slate-300">
																	{item.source}
																</span>
															</div>
															<div>
																<span className="text-slate-500 dark:text-slate-500 block">
																	Timestamp
																</span>
																<span className="text-slate-700 dark:text-slate-300">
																	{new Date(item.timestamp).toLocaleString()}
																</span>
															</div>
														</div>
													</td>
												</tr>
											)}
										</React.Fragment>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
