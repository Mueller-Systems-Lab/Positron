import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import type { HealthStatus } from '../../types.js';

export default function SystemHealth(): React.ReactElement {
	const [health, setHealth] = useState<HealthStatus | null>(null);
	const [error, setError] = useState(false);

	const fetch = useCallback(async () => {
		try {
			const data = await api.getHealth();
			setHealth(data);
			setError(false);
		} catch {
			setError(true);
		}
	}, []);

	useEffect(() => {
		fetch();
		const interval = setInterval(fetch, 30_000);
		return () => clearInterval(interval);
	}, [fetch]);

	if (error) {
		return (
			<div className="card border-red-800 bg-red-950/20">
				<div className="flex items-center gap-2">
					<span className="w-2 h-2 rounded-full bg-red-500" />
					<span className="text-sm text-red-400">Backend unreachable</span>
				</div>
			</div>
		);
	}

	if (!health) {
		return (
			<div className="card">
				<div className="skeleton h-4 w-48" />
			</div>
		);
	}

	const adapters = Object.entries(health.adapters ?? {});
	const uptimeMinutes = Math.floor(health.uptime / 60);
	const uptimeStr =
		uptimeMinutes > 60
			? `${Math.floor(uptimeMinutes / 60)}h ${uptimeMinutes % 60}m`
			: `${uptimeMinutes}m`;
	const isFakeMode = health.mode === 'fake';

	return (
		<div className="card">
			<h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="text-slate-500"
					aria-hidden="true"
					focusable="false"
				>
					<path d="M22 12h-4l-3 9L9 3l-3 9H2" />
				</svg>
				System Health
			</h3>

			<div className="flex items-center gap-2 mb-3">
				<span
					className={`w-2 h-2 rounded-full ${
						health.status === 'ok'
							? 'bg-green-500'
							: health.status === 'degraded'
								? 'bg-yellow-500'
								: 'bg-red-500'
					}`}
				/>
				<span className="text-sm text-slate-300">
					Backend: <span className="font-medium">{health.status}</span>
				</span>
				{health.mode && (
					<span
						className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
							isFakeMode ? 'bg-amber-900/30 text-amber-400' : 'bg-emerald-900/30 text-emerald-400'
						}`}
					>
						{isFakeMode ? '⚙️ Demo' : '🔵 Live'}
					</span>
				)}
				<span className="text-xs text-slate-500 ml-auto">Uptime: {uptimeStr}</span>
			</div>

			{adapters.length > 0 && (
				<div className="space-y-1.5 pt-2 border-t border-slate-800">
					{adapters.map(([name, ok]) => (
						<div key={name} className="flex items-center justify-between text-xs">
							<span className="text-slate-400">{name}</span>
							<span className={ok ? 'text-green-400' : 'text-red-400'}>
								{ok ? 'Connected' : 'Error'}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
