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

// ---------------------------------------------------------------------------
// P5.1 — Profile KPIs (Harness Profile Identity & Metrics Foundation)
// ---------------------------------------------------------------------------
//
// Aggregation nach provider / model / model_profile / task_profile /
// task_type / effective_harness_fingerprint. Kein adaptives Routing —
// P5.1 misst und identifiziert nur.
//
// Verified Success (nicht-tautologisch):
//   Ein Run zählt als verified success, wenn in `cp_decisions` eine
//   persistierte DONE-Entscheidung existiert. Die Decision Policy koppelt
//   DONE deterministisch an das Ergebnis der kanonischen Verification
//   (positron.verification.v1 passed=true, ALL_HARD_GATES_GREEN) — die
//   Metrik ist damit an die Control-Plane-Wahrheit gebunden und nicht an
//   ein bloßes attempt.status=succeeded.
//
// Gruppen-Zuordnung:
//   Ein Run wird über seine Build-Attempts (cp_jobs.job_type='build')
//   Gruppen zugeordnet. Ein Run mit Build-Attempts in mehreren Gruppen
//   zählt in jeder betroffenen Gruppe (Attempt-Telemetrie ist die Einheit).
//
// Kosten:
//   Keine Preis-/Token-Provenienz vorhanden → COST_PER_VERIFIED_SUCCESS =
//   NOT_AVAILABLE. Es wird NIE geschätzt.

/** Kanonische Legacy-Gruppe für historische Attempts ohne P5.1-Felder. */
export const LEGACY_PROFILE_GROUP = 'LEGACY_PROFILE_UNSPECIFIED';
/** Kosten sind ohne belastbare Preis-Provenienz nie verfügbar (kein Schätzen). */
export const COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE = 'NOT_AVAILABLE';

export interface ProfileKpiGroup {
	/** Effektiver Harness-Fingerprint; LEGACY_PROFILE_UNSPECIFIED für alte Rows */
	effective_harness_fingerprint: string;
	harness_profile_id: string | null;
	harness_profile_version: string | null;
	task_profile_id: string | null;
	task_profile_version: string | null;
	task_type: string | null;
	provider: string | null;
	model: string | null;
	provider_adapter_id: string | null;
	provider_adapter_version: string | null;
	model_provenance_status: string | null;
	/** Anzahl unterschiedlicher Runs mit Build-Attempt in dieser Gruppe */
	sample_size: number;
	/** Anzahl distinct DONE-Runs (verified success) mit Build-Attempt in Gruppe */
	verified_success_count: number;
	/** verified_success_count / sample_size (null bei sample_size 0) */
	verified_success_rate: number | null;
	first_pass_success_count: number;
	/** DONE-Runs mit genau 1 Build-Attempt / verified_success_count */
	first_pass_success_rate: number | null;
	/** Build-Attempts in dieser Gruppe */
	attempts: number;
	/** Build-Attempts in dieser Gruppe (inkl. Attempts nicht-erfolgreicher
	 *  Runs) / verified_success_count — „Beobachtete Attempts je
	 *  Verified Success" (kann durch fehlgeschlagene/abgebrochene Runs in
	 *  derselben Gruppe erhöht werden; bewusst, keine Schätzung). */
	attempts_per_verified_success: number | null;
	/** Median (ms) erster Build-Start → DONE-Entscheidung, nur verified successes */
	time_to_verified_success_ms: number | null;
	/** Build-Attempts mit previous_attempt_id / Build-Attempts (null bei 0) */
	retry_rate: number | null;
	/** Runs mit SPLIT/BLOCKED-Entscheidung / sample_size (null ohne Decision-Daten) */
	escalation_rate: number | null;
	/** Summe gemeldeter Tokens — nur bei realer Meldung, sonst null */
	tokens_total: number | null;
	/** Immer NOT_AVAILABLE ohne belastbare Preis-Provenienz */
	cost_per_verified_success: typeof COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE;
}

export interface ProfileKpiReport {
	groups: ProfileKpiGroup[];
	generated_at: string;
	cost_per_verified_success: typeof COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE;
}

interface AttemptRow {
	run_id: string;
	status: string;
	harness_fingerprint: string | null;
	harness_profile_id: string | null;
	harness_profile_version: string | null;
	task_profile_id: string | null;
	task_profile_version: string | null;
	task_type: string | null;
	provider: string | null;
	model: string | null;
	provider_adapter_id: string | null;
	provider_adapter_version: string | null;
	model_provenance_status: string | null;
	previous_attempt_id: string | null;
	started_at: string;
	tokens: number | null;
}

interface DecisionRunRow {
	run_id: string;
	decision: string;
	created_at: string;
}

function median(sortedMs: number[]): number | null {
	if (sortedMs.length === 0) return null;
	const mid = Math.floor(sortedMs.length / 2);
	const value =
		sortedMs.length % 2 === 0 ? (sortedMs[mid - 1]! + sortedMs[mid]!) / 2 : sortedMs[mid]!;
	return Math.round(value);
}

/**
 * Deterministische Profil-KPI-Aggregation aus cp_attempts + cp_decisions.
 * Historische Attempts (NULL-Harness-Felder) landen in der
 * LEGACY_PROFILE_UNSPECIFIED-Gruppe — es wird nichts erfunden.
 */
export function computeProfileKpis(db: Database.Database): ProfileKpiReport {
	const attempts = db
		.prepare(
			`SELECT a.run_id, a.status, a.harness_fingerprint, a.harness_profile_id,
			        a.harness_profile_version, a.task_profile_id, a.task_profile_version,
			        a.task_type, a.provider, a.model, a.provider_adapter_id,
			        a.provider_adapter_version, a.model_provenance_status,
			        a.previous_attempt_id, a.started_at, a.tokens
			 FROM cp_attempts a
			 JOIN cp_jobs j ON j.job_id = a.job_id
			 WHERE j.job_type = 'build'
			 ORDER BY a.started_at IS NULL, a.started_at ASC`,
		)
		.all() as unknown[] as AttemptRow[];

	const decisions = db
		.prepare('SELECT run_id, decision, created_at FROM cp_decisions ORDER BY created_at ASC')
		.all() as unknown[] as DecisionRunRow[];

	const doneRuns = new Set(decisions.filter((d) => d.decision === 'DONE').map((d) => d.run_id));
	const escalatedRuns = new Set(
		decisions
			.filter((d) => d.decision === 'SPLIT' || d.decision === 'BLOCKED')
			.map((d) => d.run_id),
	);
	// Runs mit mindestens einer persistierten Decision — Grundlage für die
	// per-Gruppe gültige escalation_rate (null, wenn die Gruppe keine
	// Decision-Daten trägt, statt global verdünnter 0.0).
	const runsWithDecisions = new Set(decisions.map((d) => d.run_id));
	const doneDecisionAt = new Map<string, string>();
	for (const d of decisions) {
		if (d.decision === 'DONE' && !doneDecisionAt.has(d.run_id)) {
			doneDecisionAt.set(d.run_id, d.created_at);
		}
	}
	// Erster Build-Start je Run (für time_to_verified_success). NULL-
	// started_at (nur bei defekten Legacy-Rows möglich) wird übersprungen,
	// damit es den echten ersten Start nicht blockiert.
	const firstBuildStartAt = new Map<string, string>();
	for (const a of attempts) {
		if (a.started_at !== null && a.started_at !== undefined && !firstBuildStartAt.has(a.run_id)) {
			firstBuildStartAt.set(a.run_id, a.started_at);
		}
	}
	// Build-Attempt-Zahl je Run (First-Pass-Definition: genau 1 Build-Attempt)
	const buildAttemptsByRun = new Map<string, number>();
	for (const a of attempts) {
		buildAttemptsByRun.set(a.run_id, (buildAttemptsByRun.get(a.run_id) ?? 0) + 1);
	}

	// Gruppen-Schlüssel = effektiver Harness-Fingerprint. Konsistent zu
	// isLegacyHarnessAttempt: eine Row ist legacy, wenn weder Profil-ID noch
	// Fingerprint gesetzt sind — partiell beschriebene Rows (id ohne
	// fingerprint) dürfen NICHT als legacy erscheinen.
	const groupKeyOf = (a: AttemptRow): string =>
		a.harness_fingerprint ??
		(a.harness_profile_id === null ? LEGACY_PROFILE_GROUP : 'PARTIAL_PROFILE_UNSPECIFIED');

	const groups = new Map<
		string,
		{
			fp: string;
			harness_profile_id: string | null;
			harness_profile_version: string | null;
			task_profile_id: string | null;
			task_profile_version: string | null;
			task_type: string | null;
			provider: string | null;
			model: string | null;
			provider_adapter_id: string | null;
			provider_adapter_version: string | null;
			model_provenance_status: string | null;
			runs: Set<string>;
			doneRuns: Set<string>;
			firstPassDoneRuns: Set<string>;
			attempts: number;
			retryAttempts: number;
			tokensReported: number;
			tokensCount: number;
			timesToSuccess: number[];
			countedDoneRuns: Set<string>;
		}
	>();

	for (const a of attempts) {
		const key = groupKeyOf(a);
		let g = groups.get(key);
		if (!g) {
			g = {
				fp: key,
				harness_profile_id: a.harness_profile_id,
				harness_profile_version: a.harness_profile_version,
				task_profile_id: a.task_profile_id,
				task_profile_version: a.task_profile_version,
				task_type: a.task_type,
				provider: a.provider,
				model: a.model,
				provider_adapter_id: a.provider_adapter_id,
				provider_adapter_version: a.provider_adapter_version,
				model_provenance_status: a.model_provenance_status,
				runs: new Set(),
				doneRuns: new Set(),
				firstPassDoneRuns: new Set(),
				countedDoneRuns: new Set(),
				attempts: 0,
				retryAttempts: 0,
				tokensReported: 0,
				tokensCount: 0,
				timesToSuccess: [],
			};
			groups.set(key, g);
		}
		g.runs.add(a.run_id);
		if (doneRuns.has(a.run_id)) g.doneRuns.add(a.run_id);
		if (doneRuns.has(a.run_id) && (buildAttemptsByRun.get(a.run_id) ?? 0) === 1) {
			g.firstPassDoneRuns.add(a.run_id);
		}
		g.attempts++;
		if (a.previous_attempt_id !== null) g.retryAttempts++;
		if (a.tokens !== null && a.tokens !== undefined) {
			g.tokensReported += a.tokens;
			g.tokensCount++;
		}
		// Time-to-verified-success je Gruppe: EIN Wert pro DONE-Run
		// (erster Build-Start → DONE-Entscheidung). Nur Runs, deren
		// Build-Attempt in dieser Gruppe liegt, zählen hier. Dedupe über
		// countedDoneRuns: ein Run mit N Build-Attempts (Fix-Kette) darf die
		// Dauer nicht N-fach in den Median einbringen.
		if (doneRuns.has(a.run_id) && !g.countedDoneRuns.has(a.run_id)) {
			g.countedDoneRuns.add(a.run_id);
			const start = firstBuildStartAt.get(a.run_id);
			const doneAt = doneDecisionAt.get(a.run_id);
			if (start && doneAt) {
				const ms = new Date(doneAt).getTime() - new Date(start).getTime();
				if (ms >= 0) g.timesToSuccess.push(ms);
			}
		}
	}

	const reportGroups: ProfileKpiGroup[] = [];
	for (const g of groups.values()) {
		const sampleSize = g.runs.size;
		const verified = g.doneRuns.size;
		const withEscalation = [...g.runs].filter((r) => escalatedRuns.has(r)).length;
		reportGroups.push({
			effective_harness_fingerprint: g.fp,
			harness_profile_id: g.harness_profile_id,
			harness_profile_version: g.harness_profile_version,
			task_profile_id: g.task_profile_id,
			task_profile_version: g.task_profile_version,
			task_type: g.task_type,
			provider: g.provider,
			model: g.model,
			provider_adapter_id: g.provider_adapter_id,
			provider_adapter_version: g.provider_adapter_version,
			model_provenance_status: g.model_provenance_status,
			sample_size: sampleSize,
			verified_success_count: verified,
			verified_success_rate: sampleSize > 0 ? round2(verified / sampleSize) : null,
			first_pass_success_count: g.firstPassDoneRuns.size,
			first_pass_success_rate: verified > 0 ? round2(g.firstPassDoneRuns.size / verified) : null,
			attempts: g.attempts,
			attempts_per_verified_success: verified > 0 ? round2(g.attempts / verified) : null,
			time_to_verified_success_ms: median(g.timesToSuccess.sort((a, b) => a - b)),
			retry_rate: g.attempts > 0 ? round2(g.retryAttempts / g.attempts) : null,
			escalation_rate:
				[...g.runs].some((r) => runsWithDecisions.has(r)) && sampleSize > 0
					? round2(withEscalation / sampleSize)
					: null,
			tokens_total: g.tokensCount > 0 ? g.tokensReported : null,
			cost_per_verified_success: COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE,
		});
	}

	reportGroups.sort((a, b) =>
		a.effective_harness_fingerprint.localeCompare(b.effective_harness_fingerprint),
	);

	return {
		groups: reportGroups,
		generated_at: nowIsoLocal(),
		cost_per_verified_success: COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE,
	};
}

function nowIsoLocal(): string {
	return new Date().toISOString();
}
