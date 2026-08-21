// Positron Control Plane — Cancellation Contract (P3.5, Phase B)
//
// Schließt die dokumentierte P3-Lücke:
//
//   Promise.race([worker(), timeout()])
//
// beendet beim Timeout NICHT den Worker-Prozess. Dieses Modul führt die
// kleinste gemeinsame Cancellation-Semantik ein:
//
//   ExecutionContext (run_id/job_id/attempt_id)
//        │
//        ├── cancellation signal (AbortSignal)
//        └── owned child process(es)
//
// Kette:
//
//   TIMEOUT
//     ↓
//   CANCEL REQUEST (AbortController.abort())
//     ↓
//   worker receives cancellation (AbortSignal)
//     ↓
//   owned child process terminated (graceful → forced)
//     ↓
//   attempt finalized TIMED_OUT
//     ↓
//   late mutation impossible (Transition-Guard in store.ts)
//
// Es werden NUR Prozesse beendet, die dem Attempt eindeutig gehören
// (ownerId/execution token). Keine willkürlichen fremden Prozesse.

/**
 * Cancellation-Token: kapselt einen Node-AbortSignal plus optional einen
 * registrierten Terminator für den Child-Prozessbaum des Workers.
 */

import type { ChildProcess } from 'node:child_process';

/**
 * Cancellation-Token: kapselt einen Node-AbortSignal plus optional einen
 * registrierten Terminator für den Child-Prozessbaum des Workers.
 */
export interface CancellationSource {
	/** Node-Standard-AbortSignal (Worker kann auf abort hören) */
	signal: AbortSignal;
	/** true, sobald Cancellation ausgelöst wurde */
	cancelled: boolean;
	/**
	 * Löst Cancellation aus: signal aborts + registrierter Terminator wird
	 * aufgerufen (graceful → forced). Idempotent.
	 */
	cancel: () => void;
	/**
	 * Registriert einen Terminator (z. B. kill des Child-Prozesses).
	 * Nur EIN Terminator pro Quelle (letzter gewinnt).
	 */
	onTerminate: (fn: () => void) => void;
}

export function createCancellationSource(): CancellationSource {
	const controller = new AbortController();
	let cancelled = false;
	let terminator: (() => void) | null = null;

	return {
		signal: controller.signal,
		get cancelled() {
			return cancelled;
		},
		cancel() {
			if (cancelled) return;
			cancelled = true;
			controller.abort();
			terminator?.();
		},
		onTerminate(fn: () => void) {
			terminator = fn;
			if (cancelled) fn();
		},
	};
}

/**
 * Graceful-Termination für einen owned Child-Prozess:
 *
 *   SIGTERM → grace period → SIGKILL
 *
 * Löst den Promise erst nach dem endgültigen Exit auf (oder nach einer
 * harten Obergrenze). Wenn `killProcessGroup` gesetzt ist, wird die gesamte
 * Prozessgruppe beendet (kill(-pid)), damit keine Enkel-Prozesse als Zombies
 * überleben. Nur bei explizitem `killProcessGroup`, nie willkürlich.
 */
export function terminateChildProcess(
	child: ChildProcess,
	options: { graceMs?: number; killProcessGroup?: boolean; exitTimeoutMs?: number } = {},
): Promise<void> {
	const graceMs = options.graceMs ?? 2000;
	const exitTimeoutMs = options.exitTimeoutMs ?? 10_000;
	const pid = child.pid;
	if (!pid) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve) => {
		let settled = false;
		let forceTimer: NodeJS.Timeout;
		const settle = (): void => {
			if (!settled) {
				settled = true;
				resolve();
			}
		};

		const hardTimer = setTimeout(settle, exitTimeoutMs);
		child.once('exit', () => {
			clearTimeout(forceTimer);
			clearTimeout(hardTimer);
			settle();
		});
		child.once('error', () => {
			clearTimeout(forceTimer);
			clearTimeout(hardTimer);
			settle();
		});

		// Zuerst graceful (SIGTERM)
		const killGroup = (signal: string): void => {
			try {
				process.kill(-pid, signal as NodeJS.Signals);
			} catch {
				child.kill(signal as NodeJS.Signals);
			}
		};
		if (options.killProcessGroup) {
			killGroup('SIGTERM');
		} else {
			child.kill('SIGTERM');
		}

		// Nach der Grace-Periode forced (SIGKILL), falls noch nicht beendet.
		forceTimer = setTimeout(() => {
			if (options.killProcessGroup) {
				killGroup('SIGKILL');
			} else {
				child.kill('SIGKILL');
			}
			// SIGKILL ist nicht blockierbar; der Exit-Listener räumt auf.
			setTimeout(settle, 100);
		}, graceMs);
	});
}

/**
 * Wartet auf den Exit eines Child-Prozesses und löst den Termination-
 * Promise dann auf. Nutzung zusammen mit terminateChildProcess.
 */
export function waitForProcessExit(
	child: ChildProcess,
	timeoutMs = 5000,
): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, timeoutMs);
		child.once('exit', () => {
			clearTimeout(timer);
			resolve();
		});
		child.once('error', () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

/**
 * `withCancellableTimeout`: ersetzt das problematische `Promise.race`-Muster.
 *
 * Beim Timeout:
 *  1. cancellation.cancel() wird aufgerufen (AbortSignal + Terminator)
 *  2. Der Promise wird mit `CancellationError` abgelehnt (kein stilles
 *     Weiterlaufen, keine unhandled rejection, keine late mutation)
 *
 * Aufrufer müssen das Ergebnis prüfen und den Attempt deterministisch auf
 * TIMED_OUT finalisieren (Transition-Guard verhindert spätere Mutation).
 */
export class CancellationError extends Error {
	readonly code = 'CANCELLED';
	constructor(message = 'worker cancelled by timeout') {
		super(message);
		this.name = 'CancellationError';
	}
}

export interface CancellableTimeoutResult<T> {
	ok: true;
	value: T;
}

export async function withCancellableTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number | undefined,
	cancellation: CancellationSource,
): Promise<CancellableTimeoutResult<T> | { ok: false; reason: 'timeout' }> {
	if (!timeoutMs || timeoutMs <= 0) {
		return { ok: true, value: await promise };
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// Unhandled-Rejection-Schutz: Das Worker-Promise darf nach dem
		// Timeout-Sieg nicht als unhandled rejection crashen (P2-Regression).
		promise.catch(() => {
			/* verspätetes Ergebnis wird bewusst verworfen */
		});
		return await new Promise((resolve, reject) => {
			timer = setTimeout(() => {
				cancellation.cancel();
				// Timeout-Sieg: kein Wurf, sondern { ok: false } — konsistent
				// mit der P3-Aufrufer-Struktur (`if (!timed.ok)`). Der
				// Worker-Prozess wurde via cancellation-Terminator beendet;
				// ein verspätetes Ergebnis kann den finalen Attempt nicht
				// mehr überschreiben (Transition-Guard + Lease-Fencing).
				resolve({ ok: false as const, reason: 'timeout' });
			}, timeoutMs);
			promise.then(
				(value) => {
					clearTimeout(timer);
					resolve({ ok: true as const, value });
				},
				(err) => {
					clearTimeout(timer);
					reject(err);
				},
			);
		});
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Hält eine Lease durch Heartbeats am Leben, solange die Arbeit läuft.
 * `renew` muss die Lease in der DB verlängern; Intervall = ttl / 3
 * (deutlich kleiner als die Lease-TTL, damit der Heartbeat nie die TTL
 * verpasst). Stoppt automatisch bei Cancellation.
 */
export function startLeaseHeartbeat(
	cancellation: CancellationSource,
	renew: () => void,
	ttlMs: number,
): { stop: () => void } {
	const intervalMs = Math.max(100, Math.floor(ttlMs / 3));
	let stopped = false;
	const stop = (): void => {
		stopped = true;
		clearInterval(timer);
	};
	const timer = setInterval(() => {
		if (stopped || cancellation.cancelled) return;
		try {
			renew();
		} catch {
			// Heartbeat-Fehler: Cancellation auslösen (Lease könnte abgelaufen
			// sein — der Worker darf dann nicht weiter mutieren).
			cancellation.cancel();
		}
	}, intervalMs);
	// P4 (Review-Fix NIT): bei Cancellation (z. B. Ownership-Verlust) stoppt
	// der Timer SOFORT — kein weiter tickender no-op-Intervall bis zum
	// runPipeline-Finally.
	cancellation.signal.addEventListener('abort', stop, { once: true });
	return { stop };
}
