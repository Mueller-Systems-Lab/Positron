// Positron Control Plane — KPIs aus persistierten Control-Plane-Daten
//
// Deterministische Metriken aus cp_attempts / cp_decisions / cp_transitions.
// Keine Metrik wird künstlich erzeugt — es zählen nur belastbare Daten.
//
// Kern-Invarianten (werden von den Tests über reale Daten bewiesen):
//   BlindRetryRate            = 0  (Retry nur nach evaluateRetry-Allow)
//   DuplicateMutationRate     = 0  (Idempotenz blockt Doppel-Dispatch)
//   SecurityHardBlockEnforcement = 100 % (Security ist kein Mehrheitsvotum)

import type Database from 'better-sqlite3';

export interface KpiReport {
	runs_total: number;
	done_runs: number;
	first_pass_success_rate: number | null;
	mean_attempts_to_done: number | null;
	/** Anteil der Wiederholungsversuche, die OHNE Information Gain gestartet
	 *  wurden (strategy_delta/new_evidence leer UND identischer Input).
	 *  Invariante: 0 — die Retry Policy blockt solche Versuche vor dem
	 *  nächsten Worker-Aufruf. */
	blind_retry_rate: number;
	/** Anzahl korrekt verweigerter Retries (RETRY_DENIED_*-Entscheidungen) */
	retry_denials: number;
	duplicate_mutation_rate: number;
	contract_validation_failure_rate: number | null;
	plan_gate_rejection_rate: number | null;
	security_block_enforcement_rate: number | null;
	useful_retry_rate: number | null;
	trace_completeness: number | null;
	p50_stage_duration_ms: number | null;
	p95_stage_duration_ms: number | null;
}

interface DecisionRow {
	run_id: string;
	decision: string;
	reason_code: string;
	contract_json: string;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function percentile(sorted: number[], p: number): number | null {
	if (sorted.length === 0) return null;
	const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
	return sorted[index] ?? null;
}

/**
 * Berechnet KPIs deterministisch aus den Control-Plane-Tabellen.
 */
export function computeKpis(db: Database.Database): KpiReport {
	const decisions = db
		.prepare(
			'SELECT run_id, decision, reason_code, contract_json FROM cp_decisions ORDER BY created_at ASC',
		)
		.all() as unknown[] as DecisionRow[];

	const runsTotal = new Set<string>();
	for (const d of decisions) runsTotal.add(d.run_id);

	// Attempts je Run (Build-Jobs) für First-Pass / Mean-Attempts
	const buildAttemptsByRun = new Map<string, number>();
	const attempts = db
		.prepare(
			`SELECT a.run_id, a.status, a.result_ref, a.input_fingerprint, a.strategy_delta, a.new_evidence
			 FROM cp_attempts a
			 JOIN cp_jobs j ON j.job_id = a.job_id
			 WHERE j.job_type = 'build'
			 ORDER BY a.started_at ASC`,
		)
		.all() as Array<{
		run_id: string;
		status: string;
		result_ref: string | null;
		input_fingerprint: string | null;
		strategy_delta: string | null;
		new_evidence: string | null;
	}>;

	for (const a of attempts) {
		buildAttemptsByRun.set(a.run_id, (buildAttemptsByRun.get(a.run_id) ?? 0) + 1);
	}

	const doneRuns = decisions.filter((d) => d.decision === 'DONE');
	const doneRunIds = new Set(doneRuns.map((d) => d.run_id));

	// First-Pass: DONE mit genau einem Build-Attempt
	const firstPass = [...doneRunIds].filter(
		(runId) => (buildAttemptsByRun.get(runId) ?? 0) === 1,
	).length;
	const firstPassSuccessRate = doneRunIds.size > 0 ? round2(firstPass / doneRunIds.size) : null;

	const attemptsPerDoneRun = [...doneRunIds]
		.map((runId) => buildAttemptsByRun.get(runId) ?? 0)
		.filter((n) => n > 0);
	const meanAttemptsToDone =
		attemptsPerDoneRun.length > 0
			? round2(attemptsPerDoneRun.reduce((a, b) => a + b, 0) / attemptsPerDoneRun.length)
			: null;

	// Blind Retry: Wiederholungsversuche ohne Information Gain.
	// Ein Wiederholungsversuch zählt als blind, wenn er ohne strategy_delta
	// und ohne new_evidence gestartet wurde UND denselben Input-Fingerprint
	// wie sein Vorgänger trägt. Die Retry Policy verhindert solche Versuche
	// vor dem Worker-Aufruf — die Rate ist damit per Konstruktion 0 und wird
	// hier aus den persistierten Attempts nachgewiesen.
	const retryDenials = decisions.filter((d) => d.reason_code.startsWith('RETRY_DENIED_')).length;
	const retryRelevant = decisions.filter(
		(d) => d.decision === 'FIX' || d.reason_code.startsWith('RETRY_DENIED_'),
	).length;

	const buildAttemptsByRunSorted = new Map<
		string,
		Array<{
			input_fingerprint: string | null;
			strategy_delta: string | null;
			new_evidence: string | null;
		}>
	>();
	for (const a of attempts) {
		const list = buildAttemptsByRunSorted.get(a.run_id) ?? [];
		list.push({
			input_fingerprint: a.input_fingerprint,
			strategy_delta: a.strategy_delta,
			new_evidence: a.new_evidence,
		});
		buildAttemptsByRunSorted.set(a.run_id, list);
	}
	let blindRetryAttempts = 0;
	let retryAttempts = 0;
	for (const runAttempts of buildAttemptsByRunSorted.values()) {
		for (let i = 1; i < runAttempts.length; i++) {
			retryAttempts++;
			const prev = runAttempts[i - 1]!;
			const cur = runAttempts[i]!;
			if (
				!cur.strategy_delta &&
				!cur.new_evidence &&
				cur.input_fingerprint &&
				cur.input_fingerprint === prev.input_fingerprint
			) {
				blindRetryAttempts++;
			}
		}
	}
	const blindRetryRate = retryAttempts > 0 ? round2(blindRetryAttempts / retryAttempts) : 0;

	// Duplicate Mutation: Attempts, die als Duplikat abgewiesen wurden
	const duplicateDispatches = attempts.filter(
		(a) => a.status === 'denied' && a.result_ref === 'duplicate-dispatch',
	).length;
	const duplicateMutationRate =
		attempts.length > 0 ? round2(duplicateDispatches / attempts.length) : 0;

	const totalDecisions = decisions.length;
	const contractFailures = decisions.filter((d) => d.reason_code === 'CONTRACT_INVALID').length;
	const planGateRejections = decisions.filter(
		(d) => d.reason_code === 'PLAN_GATE_REJECTED' || d.reason_code === 'PLAN_GATE_BLOCKED',
	).length;

	const contractValidationFailureRate =
		totalDecisions > 0 ? round2(contractFailures / totalDecisions) : null;
	const planGateRejectionRate =
		totalDecisions > 0 ? round2(planGateRejections / totalDecisions) : null;

	// Security Hard Block Enforcement:
	// Jede SECURITY_BLOCK-Entscheidung muss blockierende Findings in der
	// Basis tragen (kein Mehrheitsvotum). Enforcement = SECURITY_BLOCK mit
	// Findings / SECURITY_BLOCK-Entscheidungen.
	const securityBlockDecisions = decisions.filter((d) => d.reason_code === 'SECURITY_BLOCK');
	let securityBlockWithFindings = 0;
	for (const d of securityBlockDecisions) {
		try {
			const parsed = JSON.parse(d.contract_json) as {
				basis?: { blocking_findings?: unknown[] };
			};
			if (parsed.basis?.blocking_findings && parsed.basis.blocking_findings.length > 0) {
				securityBlockWithFindings++;
			}
		} catch {
			/* contract_json nicht parsebar → zählt nicht */
		}
	}
	const securityBlockEnforcementRate =
		securityBlockDecisions.length > 0
			? round2(securityBlockWithFindings / securityBlockDecisions.length)
			: null;

	// Useful Retry: FIX-Entscheidungen (mit Delta) / retry-relevante Entscheidungen
	const fixDecisions = decisions.filter((d) => d.decision === 'FIX').length;
	const usefulRetryRate = retryRelevant > 0 ? round2(fixDecisions / retryRelevant) : null;

	// Trace Completeness: Runs mit mindestens einer Transition UND Entscheidung
	const transitionedRuns = new Set(
		(
			db.prepare('SELECT DISTINCT run_id FROM cp_transitions').all() as Array<{ run_id: string }>
		).map((r) => r.run_id),
	);
	const completeTraces = [...runsTotal].filter((r) => transitionedRuns.has(r)).length;
	const traceCompleteness = runsTotal.size > 0 ? round2(completeTraces / runsTotal.size) : null;

	// Stage-Duration (p50/p95) aus Attempts mit start/end
	const durations = (
		db
			.prepare(
				`SELECT started_at, ended_at FROM cp_attempts
			 WHERE ended_at IS NOT NULL AND started_at IS NOT NULL`,
			)
			.all() as Array<{ started_at: string; ended_at: string }>
	)
		.map((a) => new Date(a.ended_at).getTime() - new Date(a.started_at).getTime())
		.filter((d) => d >= 0)
		.sort((a, b) => a - b);

	return {
		runs_total: runsTotal.size,
		done_runs: doneRunIds.size,
		first_pass_success_rate: firstPassSuccessRate,
		mean_attempts_to_done: meanAttemptsToDone,
		blind_retry_rate: blindRetryRate,
		retry_denials: retryDenials,
		duplicate_mutation_rate: duplicateMutationRate,
		contract_validation_failure_rate: contractValidationFailureRate,
		plan_gate_rejection_rate: planGateRejectionRate,
		security_block_enforcement_rate: securityBlockEnforcementRate,
		useful_retry_rate: usefulRetryRate,
		trace_completeness: traceCompleteness,
		p50_stage_duration_ms: percentile(durations, 50),
		p95_stage_duration_ms: percentile(durations, 95),
	};
}

/**
 * Prüft die Kern-Invarianten der Control Plane gegen reale Daten.
 * Wirft bei Verletzung — für Tests und Observability-Warnungen.
 */
export function assertKpiInvariants(report: KpiReport): string[] {
	const violations: string[] = [];
	if (report.blind_retry_rate !== 0) {
		violations.push(`blind_retry_rate must be 0, got ${report.blind_retry_rate}`);
	}
	if (report.duplicate_mutation_rate !== 0) {
		violations.push(`duplicate_mutation_rate must be 0, got ${report.duplicate_mutation_rate}`);
	}
	if (
		report.security_block_enforcement_rate !== null &&
		report.security_block_enforcement_rate < 1
	) {
		violations.push(
			`security_block_enforcement_rate must be 1, got ${report.security_block_enforcement_rate}`,
		);
	}
	return violations;
}
