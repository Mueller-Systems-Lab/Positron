import type React from 'react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { HealthStatus } from '../types.js';
import { t } from '../i18n/index.js';

type HealthStatusValue = 'ok' | 'degraded' | 'error' | 'loading';

export default function HealthIndicator(): React.ReactElement {
	const [health, setHealth] = useState<HealthStatus | null>(null);
	const [status, setStatus] = useState<HealthStatusValue>('loading');
	const [tooltip, setTooltip] = useState('');

	useEffect(() => {
		let cancelled = false;

		async function check(): Promise<void> {
			try {
				const h = await api.getHealth();
				if (cancelled) return;
				setHealth(h);
				setStatus(h.status);
				const adapterEntries = Object.entries(h.adapters ?? {});
				const adapterStatus = adapterEntries
					.map(([name, ok]) => `${name}: ${ok ? '✅' : '❌'}`)
					.join('\n');
				const modeLine = h.mode
					? `${t('Mode')}: ${h.mode === 'fake' ? '⚠️ Demo' : '🔵 Live'}`
					: '';
				setTooltip(
					[`${t('Uptime')}: ${h.uptime}s`, modeLine, '', adapterStatus].filter(Boolean).join('\n'),
				);
			} catch {
				if (cancelled) return;
				setHealth(null);
				setStatus('error');
				setTooltip('Gesundheitsprüfung fehlgeschlagen');
			}
		}

		check();
		const interval = setInterval(check, 30_000);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	const dotColor =
		status === 'ok'
			? 'bg-green-500'
			: status === 'degraded'
				? 'bg-yellow-500'
				: status === 'error'
					? 'bg-red-500'
					: 'bg-slate-500 animate-pulse';

	const label =
		status === 'ok'
			? 'Online'
			: status === 'degraded'
				? 'Eingeschränkt'
				: status === 'error'
					? 'Offline'
					: t('Checking...');

	const isFakeMode = health?.mode === 'fake';

	return (
		<div className="flex items-center gap-3">
			{/* Mode-Badge: Zeigt an ob Demo (fake) oder Live (real) Mode aktiv ist */}
			{health?.mode && (
				<div
					className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
						isFakeMode
							? 'bg-amber-900/40 text-amber-400 border border-amber-700/50'
							: 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/50'
					}`}
					title={
						isFakeMode
							? t('Demo mode: All adapters are simulated. Set POSITRON_GITHUB_MODE=real for real operation.')
							: t('Live mode: Real adapters active')
					}
				>
					<span
						className={`w-1.5 h-1.5 rounded-full ${isFakeMode ? 'bg-amber-400' : 'bg-emerald-400'}`}
					/>
					{isFakeMode ? 'Demo' : 'Live'}
				</div>
			)}

			{/* Status-Dot + Label */}
			<div className="relative group">
				<div className="flex items-center gap-2 cursor-help">
					<span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
					<span className="text-xs text-slate-400">{label}</span>
				</div>
				{tooltip && (
					<div className="absolute right-0 top-full mt-2 w-56 bg-slate-700 border border-slate-600 rounded-lg p-3 text-xs text-slate-200 whitespace-pre-line opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
						{tooltip}
					</div>
				)}
			</div>
		</div>
	);
}
