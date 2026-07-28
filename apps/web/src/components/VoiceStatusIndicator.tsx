import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { getLastSpoken, isSpeechSupported } from '../voice/voice-output.js';
import { loadVoiceSettings, toggleVoiceEnabled } from '../voice/voice-settings.js';

export default function VoiceStatusIndicator(): React.ReactElement {
	const supported = isSpeechSupported();
	const initialState = supported ? loadVoiceSettings().enabled : false;
	const [enabled, setEnabled] = useState(initialState);
	const [lastSpokenPreview, setLastSpokenPreview] = useState<string | null>(null);

	// Poll for state changes (could be toggled from Settings page)
	useEffect(() => {
		if (!supported) return;
		const interval = setInterval(() => {
			const settings = loadVoiceSettings();
			setEnabled(settings.enabled);
			const last = getLastSpoken();
			if (last) {
				const preview = last.text.length > 40 ? last.text.slice(0, 37) + '…' : last.text;
				setLastSpokenPreview(preview);
			}
		}, 2000);
		return () => clearInterval(interval);
	}, [supported]);

	const handleToggle = useCallback(() => {
		if (!supported) return;
		const next = toggleVoiceEnabled();
		setEnabled(next);
	}, [supported]);

	if (!supported) {
		return (
			<span
				className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-slate-800/50 cursor-not-allowed"
				title="Voice output not supported in this browser"
				aria-label="Voice output not supported"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					className="opacity-50"
					aria-hidden="true"
					focusable="false"
				>
					<path d="M11 5L6 9H2v6h4l5 4V5z" />
					<line x1="23" y1="9" x2="17" y2="15" />
					<line x1="17" y1="9" x2="23" y2="15" />
				</svg>
				No Voice
			</span>
		);
	}

	return (
		<button
			type="button"
			onClick={handleToggle}
			className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
				enabled
					? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-200 dark:hover:bg-purple-900/50'
					: 'bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700/50'
			}`}
			title={
				lastSpokenPreview
					? `Last: ${lastSpokenPreview}\nVoice alerts are local and optional.`
					: 'Voice alerts are local and optional. Click to toggle.'
			}
			aria-label={`Voice output ${enabled ? 'enabled' : 'disabled'}. Click to toggle.`}
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				aria-hidden="true"
				focusable="false"
			>
				<path d="M11 5L6 9H2v6h4l5 4V5z" />
				<path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
			</svg>
			Voice {enabled ? 'ON' : 'OFF'}
		</button>
	);
}
