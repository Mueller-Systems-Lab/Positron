import type React from 'react';
import { useState } from 'react';
import { api } from '../../api.js';
import type { ProjectEntry } from '../../types.js';

export default function ProjectEntryPage(): React.ReactElement {
	const [entryType, setEntryType] = useState<'existing_repository' | 'blueprint'>(
		'existing_repository',
	);
	const [name, setName] = useState('');
	const [owner, setOwner] = useState('');
	const [repository, setRepository] = useState('');
	const [blueprint, setBlueprint] = useState('');
	const [provider, setProvider] = useState('');
	const [model, setModel] = useState('');
	const [credentialRef, setCredentialRef] = useState('');
	const [workspacePath, setWorkspacePath] = useState('');
	const [entry, setEntry] = useState<ProjectEntry | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(): Promise<void> {
		setBusy(true);
		setMessage(null);
		try {
			const payload = {
				entryType,
				name,
				owner,
				repository,
				blueprint,
				provider,
				model,
				credentialRef,
			};
			await api.validateProjectEntry(payload);
			const result = await api.createProjectEntry(payload);
			setEntry(result.entry);
			setMessage('Project entry angelegt. SpecKit kann jetzt explizit initialisiert werden.');
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : 'Project entry konnte nicht angelegt werden.',
			);
		} finally {
			setBusy(false);
		}
	}

	async function initializeSpecKit(): Promise<void> {
		if (!entry || !workspacePath) return;
		setBusy(true);
		try {
			await api.initializeProjectSpecKit(entry.id, workspacePath);
			setMessage('SpecKit wurde initialisiert.');
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : 'SpecKit-Initialisierung fehlgeschlagen.',
			);
		} finally {
			setBusy(false);
		}
	}

	async function qualifyProvider(): Promise<void> {
		if (!entry || !workspacePath) return;
		setBusy(true);
		try {
			const result = await api.qualifyProjectProvider(entry.id, workspacePath);
			setMessage(`Provider/Model-Qualifizierung: ${String(result.status ?? 'unbekannt')}.`);
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : 'Provider-Qualifizierung fehlgeschlagen.',
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="max-w-3xl space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-white">Project Entry</h1>
				<p className="text-slate-400 mt-1">
					Neues Projekt aus einem bestehenden Repository oder einem Blueprint starten.
				</p>
			</div>
			<div className="card space-y-4">
				<div className="flex gap-2">
					<button
						type="button"
						className={entryType === 'existing_repository' ? 'btn-primary' : 'btn-secondary'}
						onClick={() => setEntryType('existing_repository')}
					>
						Existing Repository
					</button>
					<button
						type="button"
						className={entryType === 'blueprint' ? 'btn-primary' : 'btn-secondary'}
						onClick={() => setEntryType('blueprint')}
					>
						Blueprint
					</button>
				</div>
				<label className="block text-sm text-slate-300">
					Project name
					<input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
				</label>
				<label className="block text-sm text-slate-300">
					GitHub owner
					<input className="input mt-1" value={owner} onChange={(e) => setOwner(e.target.value)} />
				</label>
				{entryType === 'existing_repository' ? (
					<label className="block text-sm text-slate-300">
						Repository
						<input
							className="input mt-1"
							value={repository}
							onChange={(e) => setRepository(e.target.value)}
						/>
					</label>
				) : (
					<>
						<label className="block text-sm text-slate-300">
							New repository name
							<input
								className="input mt-1"
								value={repository}
								onChange={(e) => setRepository(e.target.value)}
								placeholder="project-name"
							/>
						</label>
						<label className="block text-sm text-slate-300">
							Blueprint
							<textarea
								className="input mt-1 min-h-48"
								value={blueprint}
								onChange={(e) => setBlueprint(e.target.value)}
								placeholder="# Project blueprint"
							/>
						</label>
					</>
				)}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
					<label className="block text-sm text-slate-300">
						Provider
						<input
							className="input mt-1"
							value={provider}
							onChange={(e) => setProvider(e.target.value)}
							placeholder="opencode"
						/>
					</label>
					<label className="block text-sm text-slate-300">
						Model
						<input
							className="input mt-1"
							value={model}
							onChange={(e) => setModel(e.target.value)}
						/>
					</label>
					<label className="block text-sm text-slate-300">
						Credential reference
						<input
							className="input mt-1"
							value={credentialRef}
							onChange={(e) => setCredentialRef(e.target.value)}
							placeholder="github-token"
						/>
					</label>
				</div>
				<button
					type="button"
					className="btn-primary"
					disabled={busy || !name || !owner}
					onClick={submit}
				>
					{busy ? 'Prüfe…' : 'Validieren und anlegen'}
				</button>
			</div>
			{entry && (
				<div className="card space-y-3">
					<h2 className="text-lg font-semibold text-white">{entry.name}</h2>
					<p className="text-slate-300">{entry.repositoryUrl}</p>
					<label className="block text-sm text-slate-300">
						Workspace path
						<input
							className="input mt-1"
							value={workspacePath}
							onChange={(e) => setWorkspacePath(e.target.value)}
							placeholder="/path/to/workspace"
						/>
					</label>
					<div className="flex gap-2">
						<button
							type="button"
							className="btn-secondary"
							disabled={busy || !workspacePath}
							onClick={qualifyProvider}
						>
							Provider/Model qualifizieren
						</button>
						<button
							type="button"
							className="btn-secondary"
							disabled={busy || !workspacePath}
							onClick={initializeSpecKit}
						>
							SpecKit initialisieren
						</button>
					</div>
				</div>
			)}
			{message && (
				<p className="text-sm text-slate-300" role="status">
					{message}
				</p>
			)}
		</div>
	);
}
