import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useDashboardSSE } from '../../hooks/useDashboardSSE.js';
import type { ManagedTargetProject } from '../../types.js';
import VoiceStatusIndicator from '../VoiceStatusIndicator.jsx';
import EmptyState from '../shared/EmptyState.js';
import ErrorBanner from '../shared/ErrorBanner.js';
import AttentionQueue from './AttentionQueue.jsx';
import BlueprintPanel from './BlueprintPanel.jsx';
import EvidenceSummary from './EvidenceSummary.jsx';
import NewRunModal from './NewRunModal.jsx';
import RecentActivity from './RecentActivity.jsx';
import StatusSummary from './StatusSummary.jsx';
import SystemHealth from './SystemHealth.jsx';

export default function DashboardPage(): React.ReactElement {
	const navigate = useNavigate();
	const { metrics, runs, evidence, isConnected } = useDashboardSSE();
	const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
	const [managedProjects, setManagedProjects] = useState<ManagedTargetProject[]>([]);

	useEffect(() => {
		api
			.getManagedTargetProjects()
			.then((data) => setManagedProjects(data.projects))
			.catch(() => {});
	}, []);

	const loading = !isConnected && runs.length === 0 && !metrics;
	const isCompletelyEmpty = !loading && runs.length === 0;

	const evidenceSummary = evidence
		? {
				totalArtifacts: evidence.totalArtifacts,
				artifactBreakdown: {} as Record<string, number>,
				testEvents: evidence.testEvents,
				errorEvents: evidence.errorEvents,
				warningEvents: evidence.warningEvents,
			}
		: null;

	return (
		<div>
			{/* Header */}
			<div className="flex items-center justify-between mb-6">
				<div>
					<h1>Dashboard</h1>
					<p className="text-sm text-slate-400 mt-1">
						Evidence-Gated Agent Execution Overview
						{!isConnected && runs.length > 0 && (
							<span className="ml-2 text-amber-400">(polling fallback)</span>
						)}
					</p>
				</div>
				<div className="flex items-center gap-3">
					<VoiceStatusIndicator />
					<button type="button" onClick={() => setIsNewRunModalOpen(true)} className="btn-primary">
						+ New Run
					</button>
				</div>
			</div>

			{/* Completely Empty State */}
			{isCompletelyEmpty && (
				<>
					<EmptyState
						icon="🚀"
						title="Welcome to Positron"
						description="Positron is your evidence-gated agent execution platform."
						action={{ label: 'Create Your First Run', onClick: () => setIsNewRunModalOpen(true) }}
						secondaryAction={{ label: 'Add Repository', onClick: () => navigate('/repos') }}
					/>
					<div className="mt-5">
						<BlueprintPanel />
					</div>
				</>
			)}

			{!isCompletelyEmpty && (
				<div className="space-y-5">
					<StatusSummary metrics={metrics} isLoading={loading} />

					{/* Managed Projects Overview */}
					{managedProjects.length > 0 && (
						<div className="card card-elevated">
							<div className="flex items-center justify-between mb-3">
								<h3 className="flex items-center gap-2">
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
										aria-hidden="true"
										focusable="false"
									>
										<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
										<line x1="8" y1="21" x2="16" y2="21" />
										<line x1="12" y1="17" x2="12" y2="21" />
									</svg>
									Managed External Projects
								</h3>
								<button
									type="button"
									onClick={() => navigate('/projects')}
									className="btn-ghost text-xs"
								>
									View All →
								</button>
							</div>
							{managedProjects.map((project) => {
								const statusLabel =
									{
										LOCAL_GATES_REPRODUCIBLE: 'Gates OK',
										LOCAL_GATES_BLOCKED: 'Gates Blocked',
										NOT_YET_EVALUATED: 'Not Evaluated',
										DEPLOYED: 'Deployed',
										ARCHIVED: 'Archived',
									}[project.status] ?? project.status;
								const firstRun = project.nextRecommendedRuns[0];
								return (
									<div
										key={project.id}
										className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-4 dark:border-slate-700/60 dark:bg-slate-900/50 cursor-pointer hover:border-sky-300/60 dark:hover:border-sky-700/60 transition-colors"
										onClick={() => navigate('/projects')}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												navigate('/projects');
											}
										}}
										role="button"
										tabIndex={0}
									>
										<div className="flex items-start justify-between gap-3 mb-2">
											<div>
												<div className="flex items-center gap-2">
													<span className="font-semibold text-slate-800 dark:text-slate-100">
														{project.name}
													</span>
													<span className="badge border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px]">
														{statusLabel}
													</span>
												</div>
												<div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
													{project.description}
												</div>
											</div>
											<a
												href={project.repoUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="btn-ghost text-xs shrink-0"
												onClick={(e) => e.stopPropagation()}
											>
												Repo ↗
											</a>
										</div>
										<div className="flex flex-wrap items-center gap-2 text-xs">
											{project.lastRunRef && (
												<>
													<span className="text-slate-400 font-mono" title={project.lastRunRef}>
														{project.lastRunRef.length > 40
															? `${project.lastRunRef.slice(0, 40)}…`
															: project.lastRunRef}
													</span>
													<span className="text-slate-300">·</span>
												</>
											)}
											<span className="text-slate-400">
												{project.nextRecommendedRuns.length} step
												{project.nextRecommendedRuns.length !== 1 ? 's' : ''} planned
											</span>
											{project.blockers.length > 0 && (
												<>
													<span className="text-slate-300">·</span>
													<span className="text-amber-600 dark:text-amber-400 font-medium">
														{project.blockers.length} blocker
														{project.blockers.length > 1 ? 's' : ''}
													</span>
												</>
											)}
										</div>
										{firstRun && (
											<div className="mt-3 pt-3 border-t border-slate-200/40 dark:border-slate-700/40 flex items-center gap-2">
												<svg
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
													className="text-sky-500"
													aria-hidden="true"
												>
													<title>Next run</title>
													<polyline points="9 18 15 12 9 6" />
												</svg>
												<span className="text-xs text-slate-500 dark:text-slate-400">
													Next: {firstRun}
												</span>
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}

					<BlueprintPanel />
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
						<EvidenceSummary
							isLoading={loading}
							testPassed={evidenceSummary?.testEvents ?? 0}
							testFailed={evidenceSummary?.errorEvents ?? 0}
							testSkipped={evidenceSummary?.warningEvents ?? 0}
							artifactCount={evidenceSummary?.totalArtifacts ?? 0}
							screenshotCount={0}
						/>
						<AttentionQueue runs={runs} isLoading={loading} />
					</div>
					<RecentActivity runs={runs} isLoading={loading} />
					<SystemHealth />
				</div>
			)}

			<NewRunModal isOpen={isNewRunModalOpen} onClose={() => setIsNewRunModalOpen(false)} />
		</div>
	);
}
