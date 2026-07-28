import { parsePhase } from '@positron/shared';
import type React from 'react';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useRun } from '../hooks/useRun.js';
import { useSSE } from '../hooks/useSSE.js';
import type { Phase } from '../types.js';
import ArtifactPanel from './ArtifactPanel.jsx';
import GateControls from './GateControls.jsx';
import LogViewer from './LogViewer.jsx';
import PhaseBadge from './PhaseBadge.jsx';
import PhasePipeline from './PhasePipeline.jsx';
import PhaseTimeline from './PhaseTimeline.jsx';

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

export default function RunDetail(): React.ReactElement {
	const { id } = useParams<{ id: string }>();
	const { run, isLoading, error: runError } = useRun(id ?? '');
	const {
		events,
		evidence,
		isConnected,
		runStatus: sseRunStatus,
		error: sseError,
	} = useSSE(id ?? null);
	const [errorBanner, setErrorBanner] = useState<string | null>(null);
	const [showCancelConfirm, setShowCancelConfirm] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const [cancelError, setCancelError] = useState<string | null>(null);

	// Merged status: SSE takes priority, then DB run status
	const effectiveStatus = sseRunStatus ?? run?.status ?? 'unknown';

	const isRunning = effectiveStatus === 'active';
	const isCancelled = effectiveStatus === 'cancelled';
	const isTerminal = effectiveStatus === 'done' || effectiveStatus === 'failed' || isCancelled;

	const handleCancel = useCallback(async () => {
		if (!id) return;
		setCancelling(true);
		setCancelError(null);
		try {
			await api.cancelRun(id);
			setShowCancelConfirm(false);
		} catch (err) {
			setCancelError(err instanceof Error ? err.message : 'Cancel failed');
		} finally {
			setCancelling(false);
		}
	}, [id]);

	const handleCopyRunId = useCallback(() => {
		if (run?.id) {
			navigator.clipboard.writeText(run.id).catch((err) => {
				console.warn('[RunDetail] Clipboard write failed:', err);
			});
		}
	}, [run?.id]);

	if (!id) {
		return (
			<div className="card text-center py-12">
				<p className="text-red-400">No Run ID provided</p>
				<Link to="/" className="text-blue-400 hover:underline mt-2 inline-block">
					Back to Dashboard
				</Link>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="card text-center py-12">
				<div className="animate-spin-slow inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
				<p className="text-slate-400 mt-3">Loading Run...</p>
			</div>
		);
	}

	if (!run) {
		return (
			<div className="card text-center py-12">
				<p className="text-red-400 text-lg">{runError ?? 'Run not found'}</p>
				<Link to="/" className="text-blue-400 hover:underline mt-2 inline-block">
					Back to Dashboard
				</Link>
			</div>
		);
	}

	const duration =
		run.finishedAt && run.startedAt
			? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
			: Date.now() - new Date(run.startedAt).getTime();

	return (
		<div>
			{/* Breadcrumb */}
			<div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
				<Link to="/" className="hover:text-blue-400 transition-colors">
					Dashboard
				</Link>
				<span>/</span>
				<Link to="/runs" className="hover:text-blue-400 transition-colors">
					Runs
				</Link>
				<span>/</span>
				<span className="text-slate-200 font-mono">{run.id.slice(0, 8)}</span>
			</div>

			{/* Error Banner */}
			{(errorBanner || run.lastError || cancelError) && (
				<div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm flex items-center justify-between">
					<span>{cancelError ?? run.lastError ?? errorBanner}</span>
					<button
						type="button"
						onClick={() => {
							setErrorBanner(null);
							setCancelError(null);
						}}
						className="text-red-300 hover:text-red-100 ml-2"
					>
						✕
					</button>
				</div>
			)}

			{/* SSE Error Banner */}
			{sseError && !isTerminal && (
				<div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg text-yellow-200 text-sm flex items-center gap-2">
					<span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse shrink-0" />
					<span>{sseError}</span>
				</div>
			)}

			{/* Cancelled Banner */}
			{isCancelled && (
				<div className="mb-4 p-3 bg-amber-900/30 border border-amber-700 rounded-lg text-amber-200 text-sm flex items-center gap-2">
					<span className="text-amber-400 font-bold">⚠</span>
					<span>This run was cancelled. No further actions will be processed.</span>
				</div>
			)}

			{/* Run Header */}
			<div className="card mb-6">
				<div className="flex items-start justify-between">
					<div>
						<div className="flex items-center gap-3 mb-2">
							<h1 className="text-xl font-bold text-white font-mono">Run {run.id.slice(0, 8)}</h1>
							<PhaseBadge phase={run.phase} />
							{/* Status badge */}
							<span
								className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
									isRunning
										? 'bg-blue-600/20 text-blue-400'
										: isCancelled
											? 'bg-amber-600/20 text-amber-400'
											: effectiveStatus === 'done'
												? 'bg-green-600/20 text-green-400'
												: effectiveStatus === 'failed'
													? 'bg-red-600/20 text-red-400'
													: 'bg-slate-600/20 text-slate-400'
								}`}
							>
								{effectiveStatus.toUpperCase()}
							</span>
						</div>
						<div className="space-y-1 text-sm text-slate-400">
							<p>
								<span className="text-slate-500">Repository:</span> {run.repoId}
								<span className="mx-2">·</span>
								<span className="text-slate-500">Issue:</span>{' '}
								<span className="text-blue-400 font-mono">#{run.issueNumber}</span>
							</p>
							{run.branch && (
								<p>
									<span className="text-slate-500">Branch:</span>{' '}
									<span className="font-mono text-xs text-slate-300">{run.branch}</span>
								</p>
							)}
							<p>
								<span className="text-slate-500">Started:</span>{' '}
								{new Date(run.startedAt).toLocaleString()}
								<span className="mx-2">·</span>
								<span className="text-slate-500">Duration:</span>{' '}
								{isRunning ? (
									<span className="text-blue-400 animate-pulse">
										running ({formatDuration(duration)})
									</span>
								) : (
									formatDuration(duration)
								)}
							</p>
						</div>
					</div>

					{/* Actions */}
					<div className="flex items-center gap-2">
						{/* Live Connection Status */}
						<span
							className={`flex items-center gap-1.5 text-xs ${
								isConnected ? 'text-green-400' : isTerminal ? 'text-slate-500' : 'text-yellow-400'
							}`}
						>
							<span
								className={`w-2 h-2 rounded-full ${
									isConnected
										? 'bg-green-500'
										: isTerminal
											? 'bg-slate-500'
											: 'bg-yellow-500 animate-pulse'
								}`}
							/>
							{isConnected ? 'Live' : isTerminal ? 'Completed' : 'Reconnecting'}
						</span>

						{/* Cancel Button */}
						{isRunning && (
							<>
								{!showCancelConfirm ? (
									<button
										type="button"
										onClick={() => setShowCancelConfirm(true)}
										className="btn-danger text-xs py-1 px-3"
									>
										Cancel Run
									</button>
								) : (
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => setShowCancelConfirm(false)}
											className="btn-secondary text-xs py-1 px-3"
											disabled={cancelling}
										>
											Keep
										</button>
										<button
											type="button"
											onClick={handleCancel}
											className="btn-danger text-xs py-1 px-3"
											disabled={cancelling}
										>
											{cancelling ? 'Cancelling...' : 'Confirm Cancel'}
										</button>
									</div>
								)}
							</>
						)}

						{/* Copy Run ID */}
						<button
							type="button"
							onClick={handleCopyRunId}
							className="btn-ghost text-xs py-1 px-2"
							title="Copy Run ID"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
								focusable="false"
							>
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
							</svg>
						</button>
					</div>
				</div>
			</div>

			{/* Main Content: Two columns */}
			<div className="grid grid-cols-[2fr_1fr] gap-6">
				{/* Left: Log Stream */}
				<div>
					<div className="flex items-center justify-between mb-2">
						<h2 className="text-sm font-medium text-slate-300 flex items-center gap-2">
							Event Log
							{isRunning && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
						</h2>
						<span className="text-[10px] text-slate-500">{events.length} events</span>
					</div>
					<LogViewer events={events} maxHeight="600px" />
				</div>

				{/* Right: Pipeline + Controls + Evidence + Artifacts */}
				<div className="space-y-4">
					{/* 28-Phase Pipeline (Operator Cockpit — Issue #68) */}
					<PhasePipeline
						currentPhase={run.phase}
						completedPhases={events
							.filter((e) => e.level === 'INFO' && !['ERROR', 'WARN'].includes(e.level))
							.map((e) => {
								try {
									return parsePhase(e.phase);
								} catch {
									return null;
								}
							})
							.filter((p): p is Phase => p !== null)}
						failedPhases={events
							.filter((e) => e.level === 'ERROR')
							.map((e) => {
								try {
									return parsePhase(e.phase);
								} catch {
									return null;
								}
							})
							.filter((p): p is Phase => p !== null)}
						onPhaseClick={(phase) => {
							// Scroll event log to first matching phase
							const el = document.querySelector(`[data-phase="${phase}"]`);
							el?.scrollIntoView({ behavior: 'smooth' });
						}}
					/>
					<GateControls runId={run.id} currentPhase={run.phase} />
					<ArtifactPanel runId={run.id} />

					{/* Live Evidence Panel (Issue #66) */}
					{evidence.length > 0 && (
						<div className="card">
							<h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="text-green-400"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
									<polyline points="14 2 14 8 20 8" />
								</svg>
								Live Evidence
								<span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
							</h3>
							<div className="space-y-1.5 max-h-[200px] overflow-y-auto">
								{evidence.map((item, i) => (
									<div
										key={item.id ?? i}
										className="flex items-center gap-2 py-1 px-2 rounded-md bg-slate-800/50 text-xs"
									>
										<span className="text-green-400">+</span>
										<span className="text-slate-400 font-medium">{item.kind}</span>
										<span className="text-slate-500 truncate flex-1">{item.summary}</span>
										<span className="text-[10px] text-slate-600">
											{new Date(item.createdAt).toLocaleTimeString()}
										</span>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Links */}
					<div className="card">
						<h3 className="text-sm font-medium text-slate-300 mb-2">Quick Links</h3>
						<div className="space-y-1.5">
							<Link
								to={'/evidence'}
								className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
									<polyline points="14 2 14 8 20 8" />
								</svg>
								Open Evidence
							</Link>
							<a
								href={`https://github.com/${run.repoId}/issues/${run.issueNumber}`}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
									<polyline points="15 3 21 3 21 9" />
									<line x1="10" y1="14" x2="21" y2="3" />
								</svg>
								Open Issue #{run.issueNumber}
							</a>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
