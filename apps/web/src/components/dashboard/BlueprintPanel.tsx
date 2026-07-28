import type React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';

export default function BlueprintPanel(): React.ReactElement {
	const navigate = useNavigate();
	const [blueprint, setBlueprint] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [isFetching, setIsFetching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [runId, setRunId] = useState<string | null>(null);

	// Repository and issue inputs for dynamic blueprint generation
	const [repoId, setRepoId] = useState('');
	const [issueNumber, setIssueNumber] = useState('');

	/** Fetch blueprint from the API for a given repo + issue */
	const generateBlueprint = async () => {
		const trimmedRepo = repoId.trim();
		const issueNum = Number.parseInt(issueNumber.trim(), 10);

		if (!trimmedRepo || Number.isNaN(issueNum) || issueNum < 1) {
			setError('Enter a valid repository (owner/repo) and issue number');
			return;
		}

		const parts = trimmedRepo.split('/');
		if (parts.length !== 2 || !parts[0] || !parts[1]) {
			setError('Repository must be in the format: owner/repo');
			return;
		}

		setIsFetching(true);
		setError(null);

		try {
			const result = await api.getBlueprint(parts[0], parts[1], issueNum);
			setBlueprint(result.blueprint);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to generate blueprint');
		} finally {
			setIsFetching(false);
		}
	};

	const startDemoRun = async () => {
		setIsLoading(true);
		setError(null);
		try {
			const result = await api.startDemoRun(blueprint || undefined);
			setRunId(result.run.id);
			// Navigate to run detail after short delay
			setTimeout(() => navigate(`/runs/${result.run.id}`), 800);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to start demo run');
		} finally {
			setIsLoading(false);
		}
	};

	const hasIssueSelected = repoId.trim() !== '' || issueNumber.trim() !== '';
	const showHelpMessage = !hasIssueSelected && !blueprint;

	return (
		<div className="card panel-stagger">
			<div className="flex items-center justify-between mb-4">
				<div>
					<h2 className="text-xl font-semibold text-slate-100 font-['Space_Grotesk']">
						Demo Blueprint
					</h2>
					<p className="text-sm text-slate-400 mt-1 font-['IBM_Plex_Sans']">
						Start a demo run to see the full 28-phase pipeline
					</p>
				</div>
			</div>

			{/* Repository & Issue Inputs */}
			<div className="flex items-center gap-3 mb-3">
				<input
					type="text"
					value={repoId}
					onChange={(e) => setRepoId(e.target.value)}
					placeholder="owner/repo"
					className="input flex-1 text-sm font-['IBM_Plex_Mono']"
					aria-label="Repository (owner/repo)"
				/>
				<input
					type="number"
					value={issueNumber}
					onChange={(e) => setIssueNumber(e.target.value)}
					placeholder="Issue #"
					className="input w-28 text-sm font-['IBM_Plex_Mono']"
					min="1"
					aria-label="Issue number"
				/>
				<button
					type="button"
					onClick={generateBlueprint}
					disabled={isFetching || isLoading}
					className="btn-secondary text-sm whitespace-nowrap"
				>
					{isFetching ? 'Fetching...' : 'Generate Blueprint'}
				</button>
			</div>

			{showHelpMessage && (
				<div className="mb-3 bg-slate-500/10 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 font-['IBM_Plex_Sans']">
					💡 Select a run or enter a repository and issue number above to generate a blueprint.
				</div>
			)}

			<textarea
				value={blueprint}
				onChange={(e) => setBlueprint(e.target.value)}
				placeholder="Paste a blueprint or generate one from an issue above..."
				className="input min-h-[160px] resize-y font-['IBM_Plex_Mono'] text-sm leading-relaxed"
				aria-label="Blueprint text"
			/>

			{/* Demo Warning */}
			<div className="mt-3 bg-amber-500/10 border border-amber-800 rounded-lg p-3 text-xs text-amber-400 font-['IBM_Plex_Sans']">
				⚠️ Demo runs do not push, merge, or call external tools unless explicitly enabled.
			</div>

			{error && (
				<div
					className="mt-3 bg-red-500/10 border border-red-800 rounded-lg p-3 text-xs text-red-400 font-['IBM_Plex_Sans']"
					role="alert"
				>
					{error}
				</div>
			)}

			{runId && (
				<div
					className="mt-3 bg-sky-500/10 border border-sky-800 rounded-lg p-3 text-xs text-sky-400 font-['IBM_Plex_Sans']"
					role="status"
				>
					✅ Demo run started: <code className="font-['IBM_Plex_Mono']">{runId}</code> — redirecting
					to run detail...
				</div>
			)}

			<div className="flex items-center gap-3 mt-4">
				<button
					type="button"
					onClick={startDemoRun}
					disabled={isLoading}
					className="btn-primary text-sm"
					aria-label="Start Demo Run"
				>
					{isLoading ? 'Starting...' : 'Start Demo Run'}
				</button>
			</div>
		</div>
	);
}
