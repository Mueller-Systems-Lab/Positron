import type React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';

interface NewRunModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function NewRunModal({ isOpen, onClose }: NewRunModalProps): React.ReactElement {
	const navigate = useNavigate();
	const [issueUrl, setIssueUrl] = useState('');
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!isOpen) return <></>;

	const handleCreate = async () => {
		if (!issueUrl.trim()) return;
		setCreating(true);
		setError(null);

		try {
			const data = await api.createRun(issueUrl.trim());
			onClose();
			navigate(`/runs/${data.runId}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create run');
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/50" onClick={onClose} />
			<div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg mx-4 p-6">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">New Run</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
					>
						✕
					</button>
				</div>

				<p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
					Enter a GitHub issue URL to start an evidence-gated agent execution.
				</p>

				<div className="space-y-3">
					<div>
						<label
							htmlFor="new-run-issue-url"
							className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1"
						>
							Issue URL
						</label>
						<input
							id="new-run-issue-url"
							type="text"
							placeholder="https://github.com/owner/repo/issues/123"
							value={issueUrl}
							onChange={(e) => setIssueUrl(e.target.value)}
							className="input w-full"
							autoFocus
						/>
					</div>

					{error && (
						<div className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded px-3 py-2">
							{error}
						</div>
					)}

					<div className="flex items-center justify-end gap-3 pt-2">
						<button type="button" onClick={onClose} className="btn-secondary text-sm">
							Cancel
						</button>
						<button
							type="button"
							onClick={handleCreate}
							disabled={creating || !issueUrl.trim()}
							className="btn-primary text-sm disabled:opacity-50"
						>
							{creating ? 'Creating...' : 'Start Run'}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
