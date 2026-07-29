import type React from 'react';
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import type { ManagedTargetProject, SafetyCheck } from '../../types.jsx';
import ErrorBanner from '../shared/ErrorBanner.js';

// ── Duplicate-safe stable text keys ─────────────────────────────────

export interface StableTextItem {
	key: string;
	value: string;
}

/**
 * Produces deterministic, duplicate-safe, reorder-stable keys from
 * a readonly string array.  Two occurrences of the same text receive
 * distinct keys.
 *
 * Key contract:
 * - Unique values retain their content-based key across reordering,
 * - Identical values receive deterministic occurrence keys (0, 1, …),
 * - No key depends on the callback array index.
 */
export function createStableTextItems(values: readonly string[]): StableTextItem[] {
	const occurrenceByValue = new Map<string, number>();

	return values.map((value) => {
		const occurrence = occurrenceByValue.get(value) ?? 0;
		occurrenceByValue.set(value, occurrence + 1);

		return {
			key: JSON.stringify([value, occurrence]),
			value,
		};
	});
}

// ── Status Badge ──────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
	LOCAL_GATES_REPRODUCIBLE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
	LOCAL_GATES_BLOCKED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
	NOT_YET_EVALUATED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
	DEPLOYED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
	ARCHIVED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
};

const STATUS_LABEL: Record<string, string> = {
	LOCAL_GATES_REPRODUCIBLE: 'Gates OK',
	LOCAL_GATES_BLOCKED: 'Gates Blocked',
	NOT_YET_EVALUATED: 'Not Evaluated',
	DEPLOYED: 'Deployed',
	ARCHIVED: 'Archived',
};

const ROLE_LABEL: Record<string, string> = {
	external_target_project: 'Target Project',
	proof_project: 'Proof Project',
	candidate_project: 'Candidate',
};

// ── Safety Check Icon ──────────────────────────────────────────────

function SafetyCheckRow({ check }: { check: SafetyCheck }): React.ReactElement {
	const iconMap: Record<string, string> = {
		pass: '\u2705',
		warn: '\u26a0\ufe0f',
		fail: '\u274c',
		unknown: '\u2753',
	};
	return (
		<li className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 py-0.5">
			<span className="shrink-0">{iconMap[check.status] ?? '\u2753'}</span>
			<span>
				<span className="font-medium">{check.label}</span>
				{check.description && (
					<span className="text-slate-400 dark:text-slate-500"> &mdash; {check.description}</span>
				)}
			</span>
		</li>
	);
}

// ── Project Card ───────────────────────────────────────────────────

function ProjectCard({ project }: { project: ManagedTargetProject }): React.ReactElement {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 p-5 shadow-sm transition-shadow hover:shadow-md">
			{/* Header */}
			<div className="flex items-start justify-between mb-3">
				<div>
					<div className="flex items-center gap-3">
						<h3 className="text-lg font-semibold text-slate-900 dark:text-white">{project.name}</h3>
						<span
							className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[project.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}
						>
							{STATUS_LABEL[project.status] ?? project.status}
						</span>
						<span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
							{ROLE_LABEL[project.role] ?? project.role}
						</span>
					</div>
					<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{project.description}</p>
				</div>
			</div>

			{/* Meta */}
			<div className="flex flex-wrap gap-4 text-xs text-slate-400 dark:text-slate-500 mb-3">
				<span>
					Repo:{' '}
					<a
						href={project.repoUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-blue-600 dark:text-blue-400 hover:underline"
					>
						{project.id}
					</a>
				</span>
				<span>Branch: {project.defaultBranch}</span>
				{project.lastEvidence && <span>Last Evidence: {project.lastEvidence}</span>}
				{project.lastSecurityScan && <span>Last Security Scan: {project.lastSecurityScan}</span>}
			</div>

			{/* Tech Stack Tags */}
			{project.techStack.length > 0 && (
				<div className="flex flex-wrap gap-1.5 mb-3">
					{project.techStack.map((tech) => (
						<span
							key={tech}
							className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800"
						>
							{tech}
						</span>
					))}
				</div>
			)}

			{/* Blockers (if any) */}
			{project.blockers.length > 0 && (
				<div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800">
					<p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Blockers</p>
					<ul className="list-disc list-inside text-xs text-red-600 dark:text-red-400">
						{createStableTextItems(project.blockers).map((item) => (
							<li key={item.key}>{item.value}</li>
						))}
					</ul>
				</div>
			)}

			{/* Expand/Collapse Toggle */}
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline mb-2"
				aria-expanded={expanded}
			>
				{expanded ? '\u25b2 Hide Details' : '\u25bc Show Details'}
			</button>

			{/* Expanded Content */}
			{expanded && (
				<div className="space-y-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
					{/* Safety Checks */}
					{project.safetyChecks.length > 0 && (
						<div>
							<p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
								Safety Checks
							</p>
							<ul className="space-y-0.5">
								{project.safetyChecks.map((check) => (
									<SafetyCheckRow key={check.id} check={check} />
								))}
							</ul>
						</div>
					)}

					{/* Next Recommended Runs */}
					{project.nextRecommendedRuns.length > 0 && (
						<div>
							<p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
								Next Recommended Positron Runs
							</p>
							<ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-0.5">
								{createStableTextItems(project.nextRecommendedRuns).map((item) => (
									<li key={item.key}>{item.value}</li>
								))}
							</ul>
						</div>
					)}

					{/* Security Status */}
					<div>
						<p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
							Security
						</p>
						<span className="text-sm text-slate-600 dark:text-slate-400">
							Status: <span className="font-medium">{project.securityStatus}</span>
							{project.lastSecurityScan && ` (last scan: ${project.lastSecurityScan})`}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Page ───────────────────────────────────────────────────────────

export default function ProjectsPage(): React.ReactElement {
	const [projects, setProjects] = useState<ManagedTargetProject[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		api
			.getManagedTargetProjects()
			.then((data) => {
				if (!cancelled) {
					setProjects(data.projects);
					setLoading(false);
				}
			})
			.catch((err: Error) => {
				if (!cancelled) {
					setError(err.message);
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div>
			{/* Header */}
			<div className="mb-6">
				<h1>Managed Target Projects</h1>
				<p className="text-sm text-slate-400 mt-1">
					Positron tracks external target projects. Each project below is a data entry in the
					registry — Positron orchestrates runs against their repositories. Target project code and
					business logic live in their own repositories, not in Positron.
				</p>
			</div>

			{/* Error */}
			{error && <ErrorBanner message={error} />}

			{/* Loading */}
			{loading && (
				<div className="flex items-center justify-center py-16">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
					<span className="ml-3 text-slate-400">Loading target projects&hellip;</span>
				</div>
			)}

			{/* Empty */}
			{!loading && !error && projects.length === 0 && (
				<div className="text-center py-16">
					<p className="text-4xl mb-3">{'\u{1f4e6}'}</p>
					<p className="text-slate-500 dark:text-slate-400">
						No managed target projects registered yet.
					</p>
					<p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
						Add target projects to the registry in{' '}
						<code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">
							apps/server/src/data/managed-target-projects.ts
						</code>
					</p>
				</div>
			)}

			{/* Project Cards */}
			{!loading && projects.length > 0 && (
				<div className="space-y-4">
					{projects.map((project) => (
						<ProjectCard key={project.id} project={project} />
					))}
				</div>
			)}

			{/* Footer Note */}
			{!loading && projects.length > 0 && (
				<p className="text-xs text-slate-400 dark:text-slate-500 mt-6 border-t border-slate-100 dark:border-slate-800 pt-4">
					Positron is a build/agent/evidence orchestrator. Target projects are external repositories
					tracked in this registry. No target project business logic is embedded in Positron.
				</p>
			)}
		</div>
	);
}
