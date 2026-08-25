// Positron Web — P4 Scheduler Queue Panel (Backend Truth Projection)
//
// Prinzip (P2/P4): BACKEND TRUTH FIRST. UI REPRESENTS TRUTH. UI DOES NOT
// CREATE TRUTH. Diese Komponente projiziert ausschließlich die read-only
// Backend-Endpunkte:
//   GET /api/scheduler/queue      (Queue + Kapazität)
//   GET /api/scheduler/active     (aktive Runs)
//
// Gezeigt werden: Queued / Waiting Dependency / Waiting Resource / Running /
// Priority / Repository / Reason Code + globale Kapazität
// (active runs / max active runs). Kein UI-Rewrite, keine zweite State-Truth.

import type React from 'react';
import { useEffect, useState } from 'react';
import type { SchedulerQueueItem } from '../../api.js';
import { api } from '../../api.js';

const POLL_INTERVAL_MS = 5000;

type LoadState =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'ready'; queue: SchedulerQueueItem[]; activeRuns: number; maxActiveRuns: number };

const STATE_LABEL: Record<string, string> = {
	QUEUED: 'Queued',
	WAITING_DEPENDENCY: 'Waiting Dependency',
	WAITING_RESOURCE: 'Waiting Resource',
	ADMITTED: 'Admitted',
	RUNNING: 'Running',
	COMPLETED: 'Completed',
	BLOCKED: 'Blocked',
	CANCELLED: 'Cancelled',
};

function stateBadge(state: string): string {
	switch (state) {
		case 'RUNNING':
			return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
		case 'ADMITTED':
			return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
		case 'WAITING_RESOURCE':
		case 'WAITING_DEPENDENCY':
			return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
		case 'BLOCKED':
			return 'bg-red-500/15 text-red-300 border-red-500/30';
		case 'CANCELLED':
			return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
		case 'COMPLETED':
			return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
		default:
			return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
	}
}

const PRIORITY_COLOR: Record<string, string> = {
	CRITICAL: 'text-red-300',
	HIGH: 'text-amber-300',
	NORMAL: 'text-zinc-300',
	LOW: 'text-zinc-500',
};

export default function SchedulerQueuePanel(): React.JSX.Element {
	const [state, setState] = useState<LoadState>({ kind: 'loading' });

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const [queueRes, capacityRes] = await Promise.all([
					api.getSchedulerQueue(),
					api.getSchedulerCapacity(),
				]);
				if (cancelled) return;
				setState({
					kind: 'ready',
					queue: queueRes.queue,
					activeRuns: capacityRes.activeRuns,
					maxActiveRuns: capacityRes.maxActiveRuns,
				});
			} catch (err) {
				if (cancelled) return;
				setState({
					kind: 'error',
					message: err instanceof Error ? err.message : String(err),
				});
			}
		};
		void load();
		const timer = setInterval(load, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);

	if (state.kind === 'loading') {
		return (
			<div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
				<p className="text-sm text-zinc-400">Scheduler queue wird geladen…</p>
			</div>
		);
	}
	if (state.kind === 'error') {
		return (
			<div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
				<p className="text-sm text-red-400">Scheduler-Queue nicht verfügbar: {state.message}</p>
			</div>
		);
	}

	const active = state.queue.filter(
		(q) => q.queue_state === 'RUNNING' || q.queue_state === 'ADMITTED',
	);
	const waiting = state.queue.filter(
		(q) => q.queue_state === 'WAITING_DEPENDENCY' || q.queue_state === 'WAITING_RESOURCE',
	);
	const queued = state.queue.filter((q) => q.queue_state === 'QUEUED');

	return (
		<div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-zinc-200">Scheduler Queue (P4)</h3>
				<span
					className={`rounded-full border px-2 py-0.5 text-xs ${
						state.activeRuns >= state.maxActiveRuns
							? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
							: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
					}`}
				>
					{state.activeRuns} / {state.maxActiveRuns} active runs
				</span>
			</div>

			{state.queue.length === 0 ? (
				<p className="text-sm text-zinc-500">Keine Runs in der Intake-Queue.</p>
			) : (
				<ul className="space-y-2">
					{[...active, ...queued, ...waiting].map((q) => (
						<li
							key={q.queue_item_id}
							className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="truncate font-mono text-xs text-zinc-300">
									{q.repository_ref} · {q.source_ref}
								</span>
								<span
									className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${stateBadge(q.queue_state)}`}
								>
									{STATE_LABEL[q.queue_state] ?? q.queue_state}
								</span>
							</div>
							<div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
								<span className={PRIORITY_COLOR[q.priority] ?? 'text-zinc-300'}>{q.priority}</span>
								<span>{q.reason_code ?? '—'}</span>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
