import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { type AdminStats, api, getAdminToken, setAdminToken } from '../../api.js';

type AuthStatus = 'idle' | 'connecting' | 'valid' | 'error';

export default function AdminPage(): React.ReactElement {
	const [stats, setStats] = useState<AdminStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionResult, setActionResult] = useState<string | null>(null);
	const [tokenInput, setTokenInput] = useState('');
	const [authStatus, setAuthStatus] = useState<AuthStatus>('idle');
	const [authError, setAuthError] = useState<string | null>(null);

	const fetchStats = useCallback(async () => {
		try {
			const data = await api.getAdminStats();
			setStats(data);
			setAuthStatus('valid');
			setAuthError(null);
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status === 401 || status === 503) {
				setAuthError((err as Error).message);
				setAuthStatus('error');
				setStats(null);
			}
		} finally {
			setLoading(false);
		}
	}, []);

	// On mount: read stored token and auto-connect if present
	useEffect(() => {
		const existing = getAdminToken();
		if (existing) {
			setTokenInput(existing);
			setAuthStatus('connecting');
			fetchStats();
		} else {
			setLoading(false);
		}
	}, [fetchStats]);

	const handleConnect = async () => {
		const trimmed = tokenInput.trim();
		if (!trimmed) return;
		setAuthStatus('connecting');
		setAuthError(null);
		setLoading(true);
		setAdminToken(trimmed);
		// Defer fetch to allow localStorage to persist
		await new Promise((r) => setTimeout(r, 0));
		fetchStats();
	};

	const handleDisconnect = () => {
		setAdminToken('');
		setTokenInput('');
		setAuthStatus('idle');
		setStats(null);
		setAuthError(null);
		setActionResult(null);
	};

	const bulkAction = async (actionId: 'cancel' | 'retry' | 'cleanup', label: string) => {
		setActionResult(`${label}...`);
		try {
			let data: unknown;
			if (actionId === 'cancel') data = await api.bulkCancelRuns();
			else if (actionId === 'retry') data = await api.bulkRetryRuns();
			else data = await api.cleanupRuns();
			setActionResult(`${label}: ${JSON.stringify(data)}`);
			fetchStats();
		} catch (err) {
			setActionResult(`Error: ${(err as Error).message}`);
		}
	};

	return (
		<div>
			<h1>Admin Dashboard</h1>
			<p className="text-sm text-slate-400 mt-1 mb-6">System operations and database management</p>

			{/* ── Token Section ─────────────────────────────────────────── */}
			<div className="card mb-6">
				<label htmlFor="admin-token" className="block text-xs font-medium text-slate-400 mb-2">
					Admin Token
				</label>
				<div className="flex flex-col sm:flex-row gap-2">
					<input
						id="admin-token"
						type="password"
						value={tokenInput}
						onChange={(e) => setTokenInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleConnect();
						}}
						placeholder="Enter admin token..."
						autoComplete="off"
						className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
					/>
					{authStatus === 'valid' ? (
						<button
							type="button"
							onClick={handleDisconnect}
							className="btn-ghost text-sm whitespace-nowrap"
						>
							Disconnect
						</button>
					) : (
						<button
							type="button"
							onClick={handleConnect}
							disabled={!tokenInput.trim() || authStatus === 'connecting'}
							className="btn-primary text-sm whitespace-nowrap"
						>
							{authStatus === 'connecting' ? 'Connecting...' : 'Connect'}
						</button>
					)}
				</div>

				{/* Status indicator */}
				<div className="mt-2 flex items-center gap-2">
					{authStatus === 'valid' && (
						<span className="inline-flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-800 rounded-full px-2.5 py-0.5">
							<span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
							Connected
						</span>
					)}
				</div>
			</div>

			{/* ── Authentication Error ──────────────────────────────────── */}
			{authStatus === 'error' && authError && (
				<div className="bg-red-500/10 border border-red-800 rounded-lg p-3 text-xs text-red-400 mb-4">
					{authError}
				</div>
			)}

			{/* ── Loading Skeleton (only while connecting) ───────────────── */}
			{loading && (
				<div className="space-y-3 animate-pulse">
					<div className="skeleton h-8 w-32" />
					<div className="skeleton h-24 w-full" />
				</div>
			)}

			{/* ── Action Result Toast ───────────────────────────────────── */}
			{actionResult && (
				<div className="bg-sky-500/10 border border-sky-800 rounded-lg p-3 text-xs text-sky-400 mb-4">
					{actionResult}
				</div>
			)}

			{/* ── Dashboard Content (only when authenticated) ────────────── */}
			{authStatus === 'valid' && stats && (
				<>
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
						{[
							{ label: 'Total Runs', value: stats.runs.total },
							{ label: 'Active', value: stats.runs.active, color: 'text-sky-400' },
							{ label: 'Failed/Blocked', value: stats.runs.failed, color: 'text-red-400' },
							{ label: 'Done', value: stats.runs.done, color: 'text-green-400' },
							{ label: 'Repositories', value: stats.repositories },
							{ label: 'Events', value: stats.events },
							{ label: 'Artifacts', value: stats.artifacts },
							{ label: 'DB Size', value: `${stats.dbSizeMb} MB`, color: 'text-amber-400' },
						].map((item) => (
							<div key={item.label} className="card">
								<p className="text-xs text-slate-400">{item.label}</p>
								<p className={`text-2xl font-bold mt-1 ${item.color ?? 'text-slate-200'}`}>
									{item.value}
								</p>
							</div>
						))}
					</div>

					<div className="space-y-4">
						<div className="card">
							<h3 className="text-sm font-semibold mb-3">Bulk Operations</h3>
							<div className="flex flex-wrap gap-3">
								<button
									type="button"
									onClick={() => bulkAction('cancel', 'Cancel All')}
									className="btn-danger text-sm"
								>
									Cancel All Active/Blocked
								</button>
								<button
									type="button"
									onClick={() => bulkAction('retry', 'Retry Failed')}
									className="btn-secondary text-sm"
								>
									Retry All Failed
								</button>
								<button
									type="button"
									onClick={() => bulkAction('cleanup', 'Cleanup')}
									className="btn-ghost text-sm"
								>
									Cleanup Old Events (7d) + VACUUM
								</button>
							</div>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
