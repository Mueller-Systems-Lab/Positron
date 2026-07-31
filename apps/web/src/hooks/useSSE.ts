import { useCallback, useEffect, useRef, useState } from 'react';
import type { Run, RunEvent, RunStatus } from '../types.js';
import { speakEvent } from '../voice/voice-output.js';

interface EvidenceItem {
	id: string;
	kind: string;
	summary: string;
	createdAt: string;
}

const MAX_EVENTS = 500;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;

/**
 * Vom Server gesendete SSE-Event-Typen:
 * - initial: Initialer Run-State beim Verbinden
 * - run-event: Neues Run-Event (Log-Eintrag)
 * - run-update: Run-Phase/Status-Update
 * - run-control: Control-Aktion (pause/resume/abort)
 * - run-complete: Run abgeschlossen
 * - run-evidence-created: Neues Evidence-Artefakt (Issue #66)
 * - run-cancelled: Run abgebrochen (Issue #66)
 * - heartbeats als SSE-Kommentare (:keepalive)
 */
const EVENT_TYPES = [
	'initial',
	'run-event',
	'run-update',
	'run-control',
	'run-complete',
	'run-evidence-created',
	'run-cancelled',
] as const;

type SSEEventType = (typeof EVENT_TYPES)[number];

interface SSEState {
	run: Run | null;
	events: RunEvent[];
	evidence: EvidenceItem[];
	runStatus: RunStatus | null;
}

interface UseSSEResult {
	events: RunEvent[];
	evidence: EvidenceItem[];
	isConnected: boolean;
	runStatus: RunStatus | null;
	error: string | null;
	clearEvents: () => void;
}

export function useSSE(runId: string | null): UseSSEResult {
	const [state, setState] = useState<SSEState>({
		run: null,
		events: [],
		evidence: [],
		runStatus: null,
	});
	const [isConnected, setIsConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const eventSourceRef = useRef<EventSource | null>(null);
	const retryCountRef = useRef(0);

	const clearEvents = useCallback(() => {
		setState({ run: null, events: [], evidence: [], runStatus: null });
	}, []);

	useEffect(() => {
		if (!runId) {
			setIsConnected(false);
			setState({ run: null, events: [], evidence: [], runStatus: null });
			setError(null);
			return;
		}

		let reconnectTimer: ReturnType<typeof setTimeout>;
		let currentEventSource: EventSource | null = null;
		const cleanupHandlers: Array<() => void> = [];

		function connect(): void {
			if (currentEventSource) {
				currentEventSource.close();
			}

			const es = new EventSource(`/api/runs/${runId}/events/stream`);
			currentEventSource = es;
			eventSourceRef.current = es;

			es.onopen = () => {
				setIsConnected(true);
				setError(null);
				retryCountRef.current = 0;
			};

			// Named Events via addEventListener
			const handleInitial = (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data) as { run: Run; events: RunEvent[] };
					setState((prev) => ({
						...prev,
						run: data.run,
						events: data.events.slice(-MAX_EVENTS),
						runStatus: data.run.status as RunStatus,
					}));
				} catch (err) {
					if (process.env.NODE_ENV !== 'production')
						console.warn('[SSE] Failed to parse initial event:', err);
				}
			};

			const handleRunEvent = (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data) as RunEvent;
					setState((prev) => {
						const next = [...prev.events, data];
						return {
							...prev,
							events: next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next,
						};
					});
					// Voice Output: fire-and-forget, non-blocking, handled internally
					speakEvent(data);
				} catch {
					if (process.env.NODE_ENV !== 'production')
						console.warn('[SSE] Failed to parse run-event data');
				}
			};

			const handleRunUpdate = (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data) as Partial<Run>;
					setState((prev) => ({
						...prev,
						run: prev.run ? { ...prev.run, ...data } : prev.run,
						// Extract runStatus from run-update if status field present
						runStatus: (data.status as RunStatus) ?? prev.runStatus,
					}));
				} catch {
					if (process.env.NODE_ENV !== 'production')
						console.warn('[SSE] Failed to parse run-update data');
				}
			};

			const handleRunControl = (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data) as { action: string };
					if (process.env.NODE_ENV !== 'production') console.log('[SSE] Run control:', data.action);
				} catch {
					// ignore
				}
			};

			const handleRunComplete = (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data) as { phase: string; status: string };
					setState((prev) => {
						if (!prev.run) return prev;
						const updated: Record<string, unknown> = {};
						if (typeof data.phase === 'string' && data.phase.length > 0) updated.phase = data.phase;
						if (typeof data.status === 'string' && data.status.length > 0) {
							updated.status = data.status;
							(updated as { runStatus: RunStatus }).runStatus = data.status as RunStatus;
						}
						return {
							...prev,
							run: { ...prev.run, ...updated } as Run,
							runStatus: (data.status as RunStatus) ?? prev.runStatus,
						};
					});
				} catch {
					// ignore
				}
			};

			// Issue #66 — Live evidence updates
			const handleEvidenceCreated = (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data) as {
						runId: string;
						kind: string;
						summary: string;
						createdAt: string;
					};
					const item: EvidenceItem = {
						id: `${data.runId}-${data.kind}-${Date.now()}`,
						kind: data.kind,
						summary: data.summary,
						createdAt: data.createdAt,
					};
					setState((prev) => ({
						...prev,
						evidence: [...prev.evidence, item],
					}));
				} catch {
					if (process.env.NODE_ENV !== 'production')
						console.warn('[SSE] Failed to parse evidence-created event');
				}
			};

			// Issue #66 — Run cancelled
			const handleRunCancelled = (e: MessageEvent) => {
				try {
					const data = JSON.parse(e.data) as { runId: string; status: string; message?: string };
					setState((prev) => ({
						...prev,
						runStatus: 'cancelled' as RunStatus,
						run: prev.run ? { ...prev.run, status: 'cancelled' as RunStatus } : prev.run,
					}));
					if (process.env.NODE_ENV !== 'production')
						console.log('[SSE] Run cancelled:', data.message ?? 'No message');
				} catch {
					// ignore
				}
			};

			// Add all event listeners
			es.addEventListener('initial', handleInitial);
			es.addEventListener('run-event', handleRunEvent);
			es.addEventListener('run-update', handleRunUpdate);
			es.addEventListener('run-control', handleRunControl);
			es.addEventListener('run-complete', handleRunComplete);
			es.addEventListener('run-evidence-created', handleEvidenceCreated);
			es.addEventListener('run-cancelled', handleRunCancelled);

			cleanupHandlers.push(
				() => es.removeEventListener('initial', handleInitial),
				() => es.removeEventListener('run-event', handleRunEvent),
				() => es.removeEventListener('run-update', handleRunUpdate),
				() => es.removeEventListener('run-control', handleRunControl),
				() => es.removeEventListener('run-complete', handleRunComplete),
				() => es.removeEventListener('run-evidence-created', handleEvidenceCreated),
				() => es.removeEventListener('run-cancelled', handleRunCancelled),
			);

			es.onerror = () => {
				setIsConnected(false);
				es.close();

				// Exponential backoff reconnect
				const delay = Math.min(RECONNECT_BASE_MS * 2 ** retryCountRef.current, RECONNECT_MAX_MS);
				retryCountRef.current += 1;

				setError(`Connection lost. Reconnecting in ${Math.round(delay / 1000)}s...`);

				reconnectTimer = setTimeout(connect, delay);
			};
		}

		connect();

		return () => {
			if (reconnectTimer) clearTimeout(reconnectTimer);
			for (const fn of cleanupHandlers) fn();
			if (currentEventSource) {
				currentEventSource.close();
			}
			setIsConnected(false);
		};
	}, [runId]);

	return {
		events: state.events,
		evidence: state.evidence,
		isConnected,
		runStatus: state.runStatus,
		error,
		clearEvents,
	};
}
