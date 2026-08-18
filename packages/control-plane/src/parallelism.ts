// Positron Control Plane — Gemeinsame Parallelitäts-Primitive
//
// Minimaler gemeinsamer Kern für echte Fan-out/Join-Beweise (Review und
// Research). Parallelität wird NICHT über Code-Struktur (Promise.all etc.)
// behauptet, sondern über die tatsächliche zeitliche Überschneidung der
// Ausführungen bewiesen:
//
//   started_at / ended_at je Worker
//   → mindestens zwei Worker müssen sich real zeitlich überschneiden
//   → sonst PARALLELISM_NOT_PROVEN
//
// Bewusst KEIN generisches "Workflow-Framework": nur der Zeit-Overlap-Kern
// wird geteilt. Jeder Consumer (Review, Research) behält seine fachliche
// Struktur und seinen eigenen Contract.

export type ParallelismVerdict = 'PARALLELISM_PROVEN' | 'PARALLELISM_NOT_PROVEN';

/**
 * Minimaler Schnitt, den jede real beobachtete parallele Ausführung erfüllen
 * muss: eindeutige Kennung des Workers und echte Zeitstempel.
 */
export interface ParallelExecutionSlice {
	/** Fachliche Kennung (z. B. 'correctness' oder 'code') */
	kind: string;
	workerType: string;
	started_at: string;
	ended_at: string;
	duration_ms: number;
}

/**
 * Deterministischer Parallelitäts-Beweis über echte Zeitstempel.
 * Sortiert nach started_at und prüft paarweise Überschneidung:
 *   a.started_at < b.ended_at UND b.started_at < a.ended_at
 *
 * Generisch über `ParallelExecutionSlice` — Review- und Research-Ergebnisse
 * (strukturell kompatibel) nutzen dieselbe Primitive.
 */
export function assertRealParallelism<T extends ParallelExecutionSlice>(
	results: T[],
): ParallelismVerdict {
	if (results.length < 2) return 'PARALLELISM_NOT_PROVEN';
	const sorted = [...results].sort(
		(a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
	);
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (!a || !b) continue;
		const aStart = new Date(a.started_at).getTime();
		const aEnd = new Date(a.ended_at).getTime();
		const bStart = new Date(b.started_at).getTime();
		const bEnd = new Date(b.ended_at).getTime();
		if (aStart < bEnd && bStart < aEnd) {
			return 'PARALLELISM_PROVEN';
		}
	}
	return 'PARALLELISM_NOT_PROVEN';
}

/**
 * Berechnet die kumulierte beobachtete Überlappung (nur Reporting).
 * Summe der positiven Schnittmengen AUFEINANDERFOLGENDER Ausführungen.
 * Hinweis: Bei drei oder mehr gleichzeitig überlappenden Ausführungen
 * werden die Schnittmengen-Regionen mehrfach gezählt (sum of pairwise
 * overlaps, kein Union-Maß). Für den Parallelitäts-BEWEIS ist nur der
 * boolesche Verdict relevant; dieser Wert dient allein der Beobachtung.
 */
export function observedOverlapMs<T extends ParallelExecutionSlice>(results: T[]): number {
	const sorted = [...results].sort(
		(a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
	);
	let overlap = 0;
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (!a || !b) continue;
		const aStart = new Date(a.started_at).getTime();
		const aEnd = new Date(a.ended_at).getTime();
		const bStart = new Date(b.started_at).getTime();
		const bEnd = new Date(b.ended_at).getTime();
		overlap += Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
	}
	return overlap;
}
