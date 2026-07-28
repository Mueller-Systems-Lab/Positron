import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
	getAvailableVoices,
	getLastSpoken,
	isSpeechSupported,
	speakTest,
} from '../voice/voice-output.js';
import {
	type VoiceEventType,
	loadVoiceSettings,
	saveVoiceSettings,
	toggleVoiceEnabled,
} from '../voice/voice-settings.js';

const EVENT_LABELS: Record<VoiceEventType, string> = {
	run_started: 'Run started',
	phase_failed: 'Phase failed',
	run_blocked: 'Run blocked',
	human_action: 'Human action required',
	merge_blocked: 'Merge blocked',
	run_done: 'Run done',
};

function ToggleSwitch({
	enabled,
	onChange,
	label,
}: {
	enabled: boolean;
	onChange: (v: boolean) => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={() => onChange(!enabled)}
			role="switch"
			aria-checked={enabled}
			aria-label={label}
			className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 ${
				enabled ? 'bg-green-500' : 'bg-slate-600 dark:bg-slate-600'
			}`}
		>
			<span
				className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ${
					enabled ? 'translate-x-4' : 'translate-x-0'
				}`}
			/>
		</button>
	);
}

export default function VoiceControls(): React.ReactElement {
	const supported = isSpeechSupported();
	const [enabled, setEnabled] = useState(false);
	const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
	const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);
	const [rate, setRate] = useState(1.0);
	const [volume, setVolume] = useState(1.0);
	const [eventTypes, setEventTypes] = useState<VoiceEventType[]>([]);
	const [lastSpoken, setLastSpokenState] = useState<{ text: string; time: string } | null>(null);
	const [testStatus, setTestStatus] = useState<'idle' | 'speaking'>('idle');

	// Load settings from localStorage
	useEffect(() => {
		const settings = loadVoiceSettings();
		setEnabled(settings.enabled);
		setSelectedVoiceURI(settings.selectedVoiceURI);
		setRate(settings.rate);
		setVolume(settings.volume);
		setEventTypes(settings.enabledEventTypes);
	}, []);

	// Load available voices (async — voices may arrive after initial render)
	useEffect(() => {
		if (!supported) return;

		const loadVoices = () => {
			const available = getAvailableVoices();
			setVoices(available);
			// Auto-select first voice if none selected
			if (available.length > 0 && !selectedVoiceURI && available[0]) {
				setSelectedVoiceURI(available[0].voiceURI);
			}
		};

		loadVoices();
		window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
		return () => {
			window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
		};
	}, [supported, selectedVoiceURI]);

	// Poll last spoken event
	useEffect(() => {
		if (!enabled) return;
		const interval = setInterval(() => {
			const last = getLastSpoken();
			if (last) {
				setLastSpokenState({
					text: last.text.length > 60 ? last.text.slice(0, 57) + '…' : last.text,
					time: new Date(last.timestamp).toLocaleTimeString(),
				});
			}
		}, 1000);
		return () => clearInterval(interval);
	}, [enabled]);

	const handleToggle = useCallback(() => {
		const next = toggleVoiceEnabled();
		setEnabled(next);
	}, []);

	const handleVoiceChange = useCallback((uri: string) => {
		setSelectedVoiceURI(uri);
		const settings = loadVoiceSettings();
		saveVoiceSettings({ ...settings, selectedVoiceURI: uri });
	}, []);

	const handleRateChange = useCallback((value: number) => {
		setRate(value);
		const settings = loadVoiceSettings();
		saveVoiceSettings({ ...settings, rate: value });
	}, []);

	const handleVolumeChange = useCallback((value: number) => {
		setVolume(value);
		const settings = loadVoiceSettings();
		saveVoiceSettings({ ...settings, volume: value });
	}, []);

	const handleEventTypeToggle = useCallback(
		(type: VoiceEventType) => {
			const next = eventTypes.includes(type)
				? eventTypes.filter((t) => t !== type)
				: [...eventTypes, type];
			setEventTypes(next);
			const settings = loadVoiceSettings();
			saveVoiceSettings({ ...settings, enabledEventTypes: next });
		},
		[eventTypes],
	);

	const handleTestVoice = useCallback(() => {
		setTestStatus('speaking');
		speakTest();
		setTimeout(() => setTestStatus('idle'), 3000);
	}, []);

	return (
		<div className="card">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<div>
					<h3 className="text-sm font-medium text-slate-800 dark:text-slate-300 flex items-center gap-2 font-['Space_Grotesk']">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="text-purple-400"
							aria-hidden="true"
							focusable="false"
						>
							<path d="M11 5L6 9H2v6h4l5 4V5z" />
							<path
								d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"
								className={enabled ? '' : 'opacity-30'}
							/>
						</svg>
						Voice Output
					</h3>
					<p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
						Voice alerts for important operator events — local browser TTS only.
					</p>
				</div>
				<ToggleSwitch enabled={enabled} onChange={handleToggle} label="Voice Output" />
			</div>

			{/* Browser Support Status */}
			<div
				className={`mb-4 p-2 rounded text-xs font-medium ${
					supported
						? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
						: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
				}`}
			>
				{supported
					? `Browser TTS supported — ${voices.length} voice(s) available`
					: 'Browser TTS not supported — voice output unavailable'}
			</div>

			{/* Unsupported State */}
			{!supported && (
				<div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
					<p className="text-xs text-amber-700 dark:text-amber-400">
						Your browser does not support the Web Speech API. Voice output requires a modern browser
						(Chrome, Firefox, Edge, or Safari 15+).
					</p>
				</div>
			)}

			{/* Controls (disabled when !enabled) */}
			<div className={`space-y-3 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
				{/* Voice Selection */}
				{voices.length > 0 && (
					<div>
						<label
							htmlFor="voice-select"
							className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
						>
							Voice
						</label>
						<select
							id="voice-select"
							value={selectedVoiceURI ?? ''}
							onChange={(e) => handleVoiceChange(e.target.value)}
							className="input text-xs"
						>
							{voices.map((v) => (
								<option key={v.voiceURI} value={v.voiceURI}>
									{v.name} ({v.lang})
								</option>
							))}
						</select>
					</div>
				)}

				{/* Rate Slider */}
				<div>
					<label
						htmlFor="rate-slider"
						className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
					>
						Speed: {rate.toFixed(1)}x
					</label>
					<input
						id="rate-slider"
						type="range"
						min="0.5"
						max="2.0"
						step="0.1"
						value={rate}
						onChange={(e) => handleRateChange(Number.parseFloat(e.target.value))}
						className="w-full accent-purple-500"
						aria-label="Speech rate"
					/>
					<div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
						<span>0.5x</span>
						<span>1.0x</span>
						<span>2.0x</span>
					</div>
				</div>

				{/* Volume Slider */}
				<div>
					<label
						htmlFor="volume-slider"
						className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
					>
						Volume: {Math.round(volume * 100)}%
					</label>
					<input
						id="volume-slider"
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={volume}
						onChange={(e) => handleVolumeChange(Number.parseFloat(e.target.value))}
						className="w-full accent-purple-500"
						aria-label="Speech volume"
					/>
				</div>

				{/* Test Voice Button */}
				<div>
					<button
						type="button"
						onClick={handleTestVoice}
						disabled={testStatus === 'speaking'}
						className="btn-secondary text-xs py-1.5 px-3"
						aria-label="Test voice output"
					>
						{testStatus === 'speaking' ? 'Speaking…' : 'Test Voice'}
					</button>
				</div>

				{/* Event Type Checkboxes */}
				<fieldset className="pt-3 border-t border-slate-200 dark:border-slate-800">
					<legend className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
						Speak these events:
					</legend>
					<div className="space-y-1.5">
						{Object.entries(EVENT_LABELS).map(([type, label]) => (
							<label
								key={type}
								className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-400"
							>
								<input
									type="checkbox"
									checked={eventTypes.includes(type as VoiceEventType)}
									onChange={() => handleEventTypeToggle(type as VoiceEventType)}
									className="rounded accent-purple-500"
								/>
								{label}
							</label>
						))}
					</div>
				</fieldset>

				{/* Last Spoken Status */}
				{lastSpoken && (
					<div className="pt-3 border-t border-slate-200 dark:border-slate-800">
						<p className="text-[10px] text-slate-500 dark:text-slate-500 mb-1">
							Last spoken — {lastSpoken.time}
						</p>
						<p className="text-xs text-slate-600 dark:text-slate-400 font-mono">
							{lastSpoken.text}
						</p>
					</div>
				)}
			</div>

			{/* Privacy Notice */}
			<p className="text-[10px] text-slate-400 dark:text-slate-600 mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
				Voice output is local browser TTS. No audio is sent to external services. No data leaves
				your browser.
			</p>
		</div>
	);
}
