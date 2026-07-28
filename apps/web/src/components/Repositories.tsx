import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import type { Issue, Repository } from '../types.js';

export default function Repositories(): React.ReactElement {
	const navigate = useNavigate();
	const [repos, setRepos] = useState<Repository[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [newOwner, setNewOwner] = useState('');
	const [newName, setNewName] = useState('');
	const [adding, setAdding] = useState(false);
	const [issuesMap, setIssuesMap] = useState<Map<string, Issue[]>>(new Map());
	const [loadingIssues, setLoadingIssues] = useState<Set<string>>(new Set());

	const fetchRepos = useCallback(async () => {
		try {
			const data = await api.getRepos();
			setRepos(data.repos);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load repositories');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchRepos();
	}, [fetchRepos]);

	async function handleAddRepo(): Promise<void> {
		if (!newOwner || !newName) return;
		setAdding(true);
		setError(null);
		try {
			await api.createRepo(newOwner, newName);
			setIsAddModalOpen(false);
			setNewOwner('');
			setNewName('');
			await fetchRepos();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to add repository');
		} finally {
			setAdding(false);
		}
	}

	async function handleLoadIssues(repoId: string): Promise<void> {
		if (issuesMap.has(repoId)) return;
		setLoadingIssues((prev) => new Set(prev).add(repoId));
		try {
			const data = await api.getRepoIssues(repoId);
			setIssuesMap((prev) => new Map(prev).set(repoId, data.issues));
		} catch {
			setIssuesMap((prev) => new Map(prev).set(repoId, []));
		} finally {
			setLoadingIssues((prev) => {
				const next = new Set(prev);
				next.delete(repoId);
				return next;
			});
		}
	}

	async function handleStartRun(repoId: string, issueNumber: number): Promise<void> {
		try {
			const { run: startedRun } = await api.startRun(repoId, issueNumber);
			navigate(`/runs/${startedRun.id}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to start run');
		}
	}

	return (
		<div>
			{/* Header */}
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-2xl font-bold text-white">📁 Repositories</h1>
				<button type="button" onClick={() => setIsAddModalOpen(true)} className="btn-primary">
					+ Add Repository
				</button>
			</div>

			{/* Error */}
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

			{/* Repo List */}
			{loading ? (
				<div className="card text-center py-12">
					<div className="animate-spin-slow inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
					<p className="text-slate-400 mt-3">Lade Repositories...</p>
				</div>
			) : repos.length === 0 ? (
				<div className="card text-center py-12">
					<p className="text-4xl mb-3">📂</p>
					<p className="text-slate-400 text-lg mb-4">Keine Repositories registriert</p>
					<button type="button" onClick={() => setIsAddModalOpen(true)} className="btn-primary">
						Repository hinzufügen
					</button>
				</div>
			) : (
				<div className="space-y-4">
					{repos.map((repo) => {
						const issues = issuesMap.get(repo.id);
						return (
							<div key={repo.id} className="card">
								<div className="flex items-center justify-between mb-3">
									<div>
										<h3 className="text-base font-medium text-white">
											{repo.owner}/{repo.name}
										</h3>
										<p className="text-xs text-slate-500 mt-0.5">
											Erstellt: {new Date(repo.createdAt).toLocaleDateString()}
										</p>
									</div>
									<button
										type="button"
										onClick={() => handleLoadIssues(repo.id)}
										disabled={loadingIssues.has(repo.id)}
										className="btn-secondary text-xs"
									>
										{loadingIssues.has(repo.id)
											? 'Lade...'
											: issues
												? `${issues.length} Issues`
												: 'Issues laden'}
									</button>
								</div>

								{issues && issues.length > 0 && (
									<div className="border-t border-slate-700 pt-3 mt-3">
										<p className="text-xs text-slate-400 mb-2">Offene Issues:</p>
										<div className="space-y-1">
											{issues.slice(0, 10).map((issue) => (
												<div
													key={issue.id}
													className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-700/50"
												>
													<span className="text-sm text-slate-300">
														<span className="text-blue-400 font-mono mr-2">#{issue.number}</span>
														{issue.title}
													</span>
													<button
														type="button"
														onClick={() => handleStartRun(repo.id, issue.number)}
														className="text-xs text-blue-400 hover:text-blue-300"
													>
														▶ Run starten
													</button>
												</div>
											))}
											{issues.length > 10 && (
												<p className="text-xs text-slate-500 text-center pt-1">
													... und {issues.length - 10} weitere
												</p>
											)}
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* Add Repository Modal */}
			{isAddModalOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					<div
						className="absolute inset-0 bg-black/60 backdrop-blur-sm"
						onClick={() => setIsAddModalOpen(false)}
					/>
					<div className="relative bg-slate-800 rounded-2xl border border-slate-700 p-6 w-full max-w-md mx-4 shadow-2xl">
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-bold text-white">Repository hinzufügen</h2>
							<button
								type="button"
								onClick={() => setIsAddModalOpen(false)}
								className="text-slate-400 hover:text-white text-xl"
							>
								✕
							</button>
						</div>

						<div className="space-y-4">
							<div>
								<label htmlFor="repo-owner" className="block text-sm text-slate-300 mb-1">
									Owner
								</label>
								<input
									id="repo-owner"
									type="text"
									placeholder="z.B. xxammaxx"
									value={newOwner}
									onChange={(e) => setNewOwner(e.target.value)}
									className="input"
								/>
							</div>
							<div>
								<label htmlFor="repo-name" className="block text-sm text-slate-300 mb-1">
									Repository-Name
								</label>
								<input
									id="repo-name"
									type="text"
									placeholder="z.B. Positron"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
									className="input"
								/>
							</div>
							<button
								type="button"
								onClick={handleAddRepo}
								disabled={!newOwner || !newName || adding}
								className="btn-primary w-full"
							>
								{adding ? 'Wird hinzugefügt...' : 'Repository hinzufügen'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
