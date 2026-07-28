import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import VoiceControls from '../VoiceControls.jsx';
import ErrorBanner from '../shared/ErrorBanner.js';
import LoadingSkeleton from '../shared/LoadingSkeleton.js';

interface McpServer {
	name: string;
	command: string;
	description: string;
	disabled: boolean;
	envKeys: string[];
	hasToken: boolean;
}

interface TestMode {
	id: string;
	label: string;
	command: string;
	visible: boolean;
	description: string;
}

function ToggleSwitch({
	enabled,
	onChange,
	label,
}: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
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

const SAFETY_LABELS: Record<string, string> = {
	enableMerge: 'Enable Merge',
	mergeDryRun: 'Merge Dry Run',
	enablePush: 'Enable Push',
	killSwitch: 'Kill Switch',
	enableFixLoop: 'Fix Loop',
};

const SAFETY_DESCRIPTIONS: Record<string, string> = {
	enableMerge: 'Allow automated merging of pull requests',
	mergeDryRun: 'Run merge validation without actually merging',
	enablePush: 'Allow pushing to remote repositories',
	killSwitch: 'Emergency stop — blocks all automated actions',
	enableFixLoop: 'Allow automatic retry of failed pipeline phases',
};

export default function SettingsPage(): React.ReactElement {
	const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
	const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
	const [redactCount, setRedactCount] = useState(0);
	const [mcpLoading, setMcpLoading] = useState(true);
	const [mcpError, setMcpError] = useState<string | null>(null);

	const [modes, setModes] = useState<TestMode[]>([]);
	const [securityNotes, setSecurityNotes] = useState<Record<string, string>>({});
	const [modesLoading, setModesLoading] = useState(true);
	const [modesError, setModesError] = useState<string | null>(null);

	const [safety, setSafety] = useState<Record<string, boolean> | null>(null);
	const [safetyLoading, setSafetyLoading] = useState(true);
	const [savingSafety, setSavingSafety] = useState<string | null>(null);
	const [safetyError, setSafetyError] = useState<string | null>(null);

	const fetchMcp = useCallback(async () => {
		try {
			const data = await api.getMcpSettings();
			setMcpServers(data.servers);
			setPolicy(data.policy);
			setRedactCount(data.redactPatternCount);
			setMcpError(null);
		} catch (err) {
			setMcpError(err instanceof Error ? err.message : 'Failed to load MCP settings');
		} finally {
			setMcpLoading(false);
		}
	}, []);

	const fetchModes = useCallback(async () => {
		try {
			const data = await api.getTestModes();
			setModes(data.modes.filter((m) => m.visible));
			setSecurityNotes(data.securityNotes);
			setModesError(null);
		} catch (err) {
			setModesError(err instanceof Error ? err.message : 'Failed to load test modes');
		} finally {
			setModesLoading(false);
		}
	}, []);

	const fetchSafety = useCallback(async () => {
		try {
			const data = await api.getSafety();
			setSafety(data as unknown as Record<string, boolean>);
		} catch {
			/* non-critical */
		} finally {
			setSafetyLoading(false);
		}
	}, []);

	const toggleSafety = useCallback(
		async (key: string) => {
			if (!safety) return;
			setSavingSafety(key);
			setSafetyError(null);
			const newValue = !safety[key];
			// Optimistic update
			setSafety((prev) => (prev ? { ...prev, [key]: newValue } : prev));
			try {
				const result = await api.updateSafety(key, newValue);
				// Sync all flags from server response (Issue #25)
				if (result.all) {
					setSafety(result.all);
				}
			} catch (err) {
				// Revert on failure and show error
				setSafety((prev) => (prev ? { ...prev, [key]: !newValue } : prev));
				setSafetyError(err instanceof Error ? err.message : 'Failed to update safety setting');
				// Clear error after 5s
				setTimeout(() => setSafetyError(null), 5000);
			} finally {
				setSavingSafety(null);
			}
		},
		[safety],
	);

	useEffect(() => {
		fetchMcp();
		fetchModes();
		fetchSafety();
	}, [fetchMcp, fetchModes, fetchSafety]);

	return (
		<div>
			<div className="mb-6">
				<h1>Settings</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
					MCP configuration, test modes, and system safety state
				</p>
			</div>

			<div className="space-y-6">
				{/* ── Safety Gates ── */}
				{!safetyLoading && safety && (
					<div className="card">
						<h3 className="text-sm font-medium text-slate-800 dark:text-slate-300 mb-1 flex items-center gap-2 text-['Space_Grotesk']">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								className="text-amber-400"
								aria-hidden="true"
								focusable="false"
							>
								<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
							</svg>
							Safety Gates
						</h3>
						<p className="text-xs text-slate-500 dark:text-slate-500 mb-4">
							Toggle safety mechanisms. Changes take effect immediately.
						</p>
						{safetyError && (
							<div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
								<p className="text-xs text-red-700 dark:text-red-400">{safetyError}</p>
							</div>
						)}
						<div className="space-y-2">
							{Object.entries(safety).map(([key, value]) => (
								<div
									key={key}
									className="flex items-center justify-between py-2.5 px-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800"
								>
									<div className="flex-1">
										<div className="flex items-center gap-2">
											<span
												className={`w-2 h-2 rounded-full ${value ? 'bg-green-500' : 'bg-red-500'}`}
											/>
											<span className="text-xs font-medium text-slate-700 dark:text-slate-300">
												{SAFETY_LABELS[key] ?? key}
											</span>
											<span
												className={`text-[10px] font-bold ${value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
											>
												{value ? 'ON' : 'OFF'}
											</span>
										</div>
										<p className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5 ml-4">
											{SAFETY_DESCRIPTIONS[key] ?? ''}
										</p>
									</div>
									<div className="flex items-center gap-2 shrink-0">
										{savingSafety === key && (
											<span className="w-3 h-3 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
										)}
										<ToggleSwitch
											enabled={value}
											onChange={() => toggleSafety(key)}
											label={SAFETY_LABELS[key] ?? key}
										/>
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{/* ── MCP Configuration ── */}
				<div className="card">
					<h3 className="text-sm font-medium text-slate-800 dark:text-slate-300 mb-1 flex items-center gap-2 font-['Space_Grotesk']">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="text-sky-400"
							aria-hidden="true"
							focusable="false"
						>
							<rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
							<rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
							<line x1="6" y1="6" x2="6.01" y2="6" />
							<line x1="6" y1="18" x2="6.01" y2="18" />
						</svg>
						MCP Servers
					</h3>
					<p className="text-xs text-slate-500 dark:text-slate-500 mb-4">
						Model Context Protocol servers. Secrets are masked — only structure is visible.
					</p>

					{mcpLoading ? (
						<LoadingSkeleton variant="text" />
					) : mcpError ? (
						<ErrorBanner message={mcpError} onRetry={fetchMcp} />
					) : (
						<div className="space-y-3">
							{mcpServers.map((server) => (
								<div
									key={server.name}
									className={`p-3 rounded-lg border transition-opacity ${
										server.disabled
											? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/20 opacity-60'
											: 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30'
									}`}
								>
									<div className="flex items-center justify-between mb-1">
										<div className="flex items-center gap-2">
											<span
												className={`w-2 h-2 rounded-full ${server.disabled ? 'bg-slate-400 dark:bg-slate-500' : 'bg-green-500'}`}
											/>
											<span className="text-sm font-medium text-slate-700 dark:text-slate-200">
												{server.name}
											</span>
											{server.disabled && (
												<span className="text-[10px] text-slate-500">(disabled)</span>
											)}
										</div>
										<code className="text-[10px] text-slate-500 dark:text-slate-500 font-mono">
											{server.command}
										</code>
									</div>
									<p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
										{server.description}
									</p>
									<div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-500">
										{server.envKeys.length > 0 && (
											<span>
												Env vars: {server.envKeys.join(', ')}
												{server.hasToken && (
													<span className="text-amber-600 dark:text-amber-400 ml-1">
														(token configured, masked)
													</span>
												)}
											</span>
										)}
										{server.disabled && (
											<span className="text-amber-600 dark:text-amber-400">
												⚠ Disabled — enable to activate
											</span>
										)}
									</div>
								</div>
							))}
							{mcpServers.length === 0 && (
								<p className="text-xs text-slate-500 dark:text-slate-500">
									No MCP servers configured.
								</p>
							)}
						</div>
					)}

					{policy && (
						<div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
							<h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 font-['Space_Grotesk']">
								Security Policy
							</h4>
							<div className="grid grid-cols-2 gap-x-4 gap-y-1">
								{Object.entries(policy).map(([key, value]) => {
									if (['allowedWriteActions', 'deniedActions', 'pathRestrictions'].includes(key))
										return null;
									return (
										<div key={key} className="flex items-center justify-between text-xs">
											<span className="text-slate-500 dark:text-slate-500">{key}</span>
											<span
												className={
													value
														? 'text-green-600 dark:text-green-400'
														: 'text-red-600 dark:text-red-400'
												}
											>
												{String(value).toUpperCase()}
											</span>
										</div>
									);
								})}
							</div>
							{redactCount > 0 && (
								<p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
									{redactCount} secret patterns configured.
								</p>
							)}
						</div>
					)}
				</div>

				{/* ── Test Modes ── */}
				<div className="card">
					<h3 className="text-sm font-medium text-slate-800 dark:text-slate-300 mb-1 flex items-center gap-2 font-['Space_Grotesk']">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="text-amber-400"
							aria-hidden="true"
							focusable="false"
						>
							<path d="M9 11l3 3L22 4" />
							<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
						</svg>
						Test Modes
					</h3>
					<p className="text-xs text-slate-500 dark:text-slate-500 mb-4">
						Available test modes for different observation levels.
					</p>

					{modesLoading ? (
						<LoadingSkeleton variant="text" />
					) : modesError ? (
						<ErrorBanner message={modesError} onRetry={fetchModes} />
					) : (
						<div className="space-y-2">
							{modes.map((mode) => (
								<div
									key={mode.id}
									className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
								>
									<div>
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium text-slate-700 dark:text-slate-200">
												{mode.label}
											</span>
											{mode.id.includes('observe') && (
												<span className="text-[10px] bg-sky-100 dark:bg-sky-600/20 text-sky-700 dark:text-sky-400 px-1.5 py-0.5 rounded">
													observe
												</span>
											)}
											{mode.id.includes('headed') && !mode.id.includes('observe') && (
												<span className="text-[10px] bg-amber-100 dark:bg-amber-600/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
													visible
												</span>
											)}
											{mode.id.includes('debug') && (
												<span className="text-[10px] bg-red-100 dark:bg-red-600/20 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded">
													debug
												</span>
											)}
										</div>
										<p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
											{mode.description}
										</p>
									</div>
									<code className="text-[10px] text-slate-500 dark:text-slate-500 font-mono">
										{mode.command}
									</code>
								</div>
							))}
							{modes.length === 0 && (
								<p className="text-xs text-slate-500">No test modes configured.</p>
							)}
						</div>
					)}

					{Object.keys(securityNotes).length > 0 && (
						<div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
							<h4 className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-2">
								⚠ Security Notes
							</h4>
							<div className="space-y-1.5">
								{Object.entries(securityNotes).map(([key, note]) => (
									<div key={key} className="flex items-start gap-2">
										<span className="text-[10px] text-amber-600 dark:text-amber-500 font-mono shrink-0 mt-0.5">
											{key}:
										</span>
										<span className="text-xs text-slate-600 dark:text-slate-400">{note}</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>

				{/* ── Voice Output ── */}
				<VoiceControls />
			</div>
		</div>
	);
}
