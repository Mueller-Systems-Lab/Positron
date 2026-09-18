import type React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { t } from '../../i18n/index.js';

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
			setError(t('Enter a valid repository and issue number'));
			return;
		}

		const parts = trimmedRepo.split('/');
		if (parts.length !== 2 || !parts[0] || !parts[1]) {
			setError(t('Repository format error'));
			return;
		}

		setIsFetching(true);
		setError(null);

		try {
			const result = await api.getBlueprint(parts[0], parts[1], issueNum);
			setBlueprint(result.blueprint);
		} catch (err) {
			setError(err instanceof Error ? err.message : t('Blueprint generation failed'));
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
			setError(err instanceof Error ? err.message : t('Demo run could not be started'));
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
						{t('Demo-Blueprint')}
					</h2>
					<p className="text-sm text-slate-400 mt-1 font-['IBM_Plex_Sans']">
						Starte einen Demo-Lauf, um die vollständige 28-Phasen-Pipeline zu sehen
					</p>
				</div>
			</div>

			{/* Repository & Issue Inputs */}
			<div className="flex items-center gap-3 mb-3">
				<input
					type="text"
					value={repoId}
					onChange={(e) => setRepoId(e.target.value)}
					placeholder="z. B. eigentümer/repository"
					className="input flex-1 text-sm font-['IBM_Plex_Mono']"
					aria-label={t('Repository identifier')}
				/>
				<input
					type="number"
					value={issueNumber}
					onChange={(e) => setIssueNumber(e.target.value)}
					placeholder="Issue-Nr."
					className="input w-28 text-sm font-['IBM_Plex_Mono']"
					min="1"
					aria-label="Issue-Nummer"
				/>
				<button
					type="button"
					onClick={generateBlueprint}
					disabled={isFetching || isLoading}
					className="btn-secondary text-sm whitespace-nowrap"
				>
					{isFetching ? 'Wird abgerufen …' : t('Generate Blueprint')}
				</button>
			</div>

			{showHelpMessage && (
				<div className="mb-3 bg-slate-500/10 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 font-['IBM_Plex_Sans']">
					💡 Wähle einen Lauf oder gib oben Repository und Issue-Nummer ein, um einen Blueprint zu erzeugen.
				</div>
			)}

			<textarea
				value={blueprint}
				onChange={(e) => setBlueprint(e.target.value)}
				placeholder="Blueprint einfügen oder oben aus einem Issue erzeugen …"
				className="input min-h-[160px] resize-y font-['IBM_Plex_Mono'] text-sm leading-relaxed"
				aria-label={t('Blueprint text')}
			/>

			{/* Demo Warning */}
			<div className="mt-3 bg-amber-500/10 border border-amber-800 rounded-lg p-3 text-xs text-amber-400 font-['IBM_Plex_Sans']">
				⚠️ Demo-Läufe pushen, mergen oder verwenden keine externen Werkzeuge, sofern dies nicht ausdrücklich aktiviert ist.
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
					✅ Demo-Lauf gestartet: <code className="font-['IBM_Plex_Mono']">{runId}</code> — Weiterleitung zur Laufansicht …
				</div>
			)}

			<div className="flex items-center gap-3 mt-4">
				<button
					type="button"
					onClick={startDemoRun}
					disabled={isLoading}
					className="btn-primary text-sm"
					aria-label="Demo-Lauf starten"
				>
					{isLoading ? 'Wird gestartet …' : t('Start Demo Run')}
				</button>
			</div>
		</div>
	);
}
