import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import type { Artifact } from '../types.js';

interface ArtifactPanelProps {
	runId: string;
}

type ArtifactKind = 'spec' | 'plan' | 'tasks' | 'diff';

const TABS: Array<{ kind: ArtifactKind; label: string }> = [
	{ kind: 'spec', label: 'Spec' },
	{ kind: 'plan', label: 'Plan' },
	{ kind: 'tasks', label: 'Tasks' },
	{ kind: 'diff', label: 'Diff' },
];

function highlightDiffLine(line: string): string {
	if (line.startsWith('+') && !line.startsWith('+++')) {
		return `<span class="text-green-400">${line}</span>`;
	}
	if (line.startsWith('-') && !line.startsWith('---')) {
		return `<span class="text-red-400">${line}</span>`;
	}
	if (line.startsWith('@@')) {
		return `<span class="text-slate-500">${line}</span>`;
	}
	return line;
}

export default function ArtifactPanel({ runId }: ArtifactPanelProps): React.ReactElement {
	const [activeTab, setActiveTab] = useState<ArtifactKind>('spec');
	const [artifact, setArtifact] = useState<Artifact | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchArtifact = useCallback(
		async (kind: ArtifactKind) => {
			setLoading(true);
			setError(null);
			try {
				const data = await api.getArtifact(runId, kind);
				setArtifact(data);
			} catch (err) {
				setError(err instanceof Error ? err.message : `Konnte ${kind} nicht laden`);
				setArtifact(null);
			} finally {
				setLoading(false);
			}
		},
		[runId],
	);

	useEffect(() => {
		fetchArtifact(activeTab);
	}, [activeTab, fetchArtifact]);

	function handleDownload(): void {
		if (!artifact) return;
		const blob = new Blob([artifact.content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${activeTab}-${runId.slice(0, 8)}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function renderContent(): string {
		if (!artifact) return '';
		if (activeTab === 'diff') {
			return artifact.content.split('\n').map(highlightDiffLine).join('\n');
		}
		return artifact.content;
	}

	return (
		<div className="card">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-sm font-medium text-slate-300">Artefakte</h3>
				{artifact && (
					<button
						type="button"
						onClick={handleDownload}
						className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
					>
						⬇ Download
					</button>
				)}
			</div>

			{/* Tabs */}
			<div className="flex gap-1 mb-3">
				{TABS.map((tab) => (
					<button
						type="button"
						key={tab.kind}
						onClick={() => setActiveTab(tab.kind)}
						className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
							activeTab === tab.kind
								? 'bg-blue-600 text-white'
								: 'bg-slate-700 text-slate-400 hover:bg-slate-600'
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* Content */}
			{loading ? (
				<div className="flex items-center justify-center py-8">
					<div className="animate-spin-slow w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
				</div>
			) : error ? (
				<div className="text-xs text-slate-500 text-center py-4">{error}</div>
			) : artifact ? (
				<pre
					className="text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto bg-slate-900 rounded-lg p-3"
					dangerouslySetInnerHTML={{ __html: renderContent() }}
				/>
			) : (
				<div className="text-xs text-slate-500 text-center py-4">Kein Artefakt verfügbar</div>
			)}
		</div>
	);
}
