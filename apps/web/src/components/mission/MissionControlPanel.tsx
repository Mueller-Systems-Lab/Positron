// Positron Web — Active Run Mission Control (P2)
//
// Prinzip: BACKEND TRUTH FIRST. UI REPRESENTS TRUTH. UI DOES NOT CREATE TRUTH.
//
// Diese Komponente projiziert ausschließlich die read-only Backend-Truth:
//   GET /api/runs/:id/control-plane  (jobs, attempts, decisions, transitions)
// und zeigt KEINEN clientseitig erfundenen oder rekonstruierten Zustand.
//
// Display-Sicherheit: output_json wird NIE gerendert (ausgenommen die
// strukturierten Verify-Gate-Checks eines positron.verification.v1).
// Freitext-Felder laufen durch sanitizeDisplayText.

import type React from 'react';
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import type {
	ControlPlaneAttempt,
	ControlPlaneDecision,
	ControlPlaneJob,
	ControlPlaneResponse,
	ControlPlaneTransition,
} from '../../api.js';
import {
	formatDurationMs,
	formatTimestamp,
	sanitizeDisplayText,
	shortHash,
	statusBadgeClass,
	statusColorClass,
} from './mission-format.js';

const POLL_INTERVAL_MS = 3000;

interface MissionControlProps {
	runId: string;
	/** Echter Run-Status vom bestehenden useRun/useSSE (nur für Anzeige) */
	runStatus?: string | null;
}

type LoadState =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'not-found' }
	| { kind: 'ready'; data: ControlPlaneResponse };

// ---------------------------------------------------------------------------
// Deterministische Projectionen (nur aus Backend-Daten)
// ---------------------------------------------------------------------------

function currentExecution(data: ControlPlaneResponse): {
	job: ControlPlaneJob;
	attempts: ControlPlaneAttempt[];
} | null {
	const sortedJobs = [...data.jobs].sort(
		(a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
	);
	if (sortedJobs.length === 0) return null;
	// Laufender/offener Job gewinnt, sonst der zuletzt erstellte
	const open =
		sortedJobs.filter((j) => j.state === 'running' || j.state === 'pending').at(-1) ??
		sortedJobs.at(-1)!;
	return {
		job: open,
		attempts: data.attempts.filter((a) => a.job_id === open.job_id),
	};
}

function attemptsOfJob(data: ControlPlaneResponse, jobType: string): ControlPlaneAttempt[] {
	const jobIds = new Set(data.jobs.filter((j) => j.job_type === jobType).map((j) => j.job_id));
	return data.attempts.filter((a) => jobIds.has(a.job_id));
}

function jobOfType(data: ControlPlaneResponse, jobType: string): ControlPlaneJob | null {
	return data.jobs.find((j) => j.job_type === jobType) ?? null;
}

function latestDecision(data: ControlPlaneResponse): ControlPlaneDecision | null {
	const sorted = [...data.decisions].sort(
		(a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
	);
	return sorted.at(-1) ?? null;
}

/** Verify-Gate-Checks aus dem strukturierten positron.verification.v1 (sicher). */
interface VerifyCheck {
	name: string;
	passed: boolean;
	kind: string;
}

function verifyChecksOf(data: ControlPlaneResponse): VerifyCheck[] {
	const checks: VerifyCheck[] = [];
	for (const attempt of attemptsOfJob(data, 'verify')) {
		if (!attempt.output_json) continue;
		try {
			const parsed = JSON.parse(attempt.output_json) as {
				checks?: Array<{ name: string; passed: boolean; kind?: string }>;
			};
			for (const c of parsed.checks ?? []) {
				if (typeof c.name === 'string') {
					checks.push({ name: c.name, passed: Boolean(c.passed), kind: c.kind ?? 'other' });
				}
			}
		} catch {
			// kaputtes output_json wird nicht gerendert (fail-safe)
		}
	}
	return checks;
}

function researchStatusOf(data: ControlPlaneResponse): {
	statuses: Array<{ kind: string; status: string; started_at: string | null; ended_at: string | null }>;
} {
	const researchJob = jobOfType(data, 'research');
	if (!researchJob) return { statuses: [] };
	const attempts = data.attempts
		.filter((a) => a.job_id === researchJob.job_id)
		.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
	return {
		statuses: attempts.map((a) => ({
			kind: (a.worker_type ?? 'research').replace('research-worker:', '').replace('research:', ''),
			status: a.status,
			started_at: a.started_at,
			ended_at: a.ended_at,
		})),
	};
}

// ---------------------------------------------------------------------------
// Teilkomponenten
// ---------------------------------------------------------------------------

function FingerprintValue({ label, value }: { label: string; value: string | null }): React.ReactElement {
	if (!value) return <span />;
	return (
		<span className="inline-flex items-center gap-1" title={`${label}: ${value}`}>
			<span className="text-slate-500">{label}</span>
			<code className="text-[10px] font-mono text-slate-400">{shortHash(value)}</code>
			<button
				type="button"
				className="text-[10px] text-slate-500 hover:text-blue-400"
				onClick={() => {
					navigator.clipboard.writeText(value).catch(() => undefined);
				}}
				aria-label={`Copy full ${label} fingerprint`}
			>
				copy
			</button>
		</span>
	);
}

function Section({
	title,
	children,
	className = '',
}: {
	title: string;
	children: React.ReactNode;
	className?: string;
}): React.ReactElement {
	return (
		<div className={`bg-slate-900/60 border border-slate-800 rounded-lg p-3 ${className}`}>
			<h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{title}</h4>
			{children}
		</div>
	);
}

function KeyValue({
	label,
	value,
	mono = false,
	valueClassName,
}: {
	label: string;
	value: React.ReactNode;
	mono?: boolean;
	valueClassName?: string;
}): React.ReactElement {
	return (
		<div className="flex items-baseline justify-between gap-2 text-xs">
			<span className="text-slate-500 shrink-0">{label}</span>
			<span
				className={`text-slate-200 text-right ${mono ? 'font-mono text-[11px]' : ''} ${valueClassName ?? ''}`}
			>
				{value}
			</span>
		</div>
	);
}

function RunTimeline({ transitions }: { transitions: ControlPlaneTransition[] }): React.ReactElement {
	if (transitions.length === 0) {
		return <p className="text-xs text-slate-500">No persisted transitions yet.</p>;
	}
	const sorted = [...transitions].sort(
		(a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
	);
	return (
		<ol className="space-y-1">
			{sorted.map((t) => (
				<li key={t.transition_id} className="flex items-center gap-2 text-xs">
					<span className="text-[10px] text-slate-600 font-mono w-16 shrink-0">
						{formatTimestamp(t.created_at)}
					</span>
					<span className={`font-mono font-medium ${statusColorClass(t.new_state)}`}>
						{t.new_state}
					</span>
					<span className="text-slate-600">·</span>
					<span className="text-slate-500 font-mono text-[11px] truncate">{t.reason_code}</span>
				</li>
			))}
		</ol>
	);
}

function AttemptHistory({ attempts }: { attempts: ControlPlaneAttempt[] }): React.ReactElement {
	if (attempts.length === 0) {
		return <p className="text-xs text-slate-500">No attempts recorded.</p>;
	}
	const sorted = [...attempts].sort(
		(a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
	);
	return (
		<div className="space-y-2">
			{sorted.map((a, index) => (
				<div key={a.attempt_id} className="border border-slate-800 rounded-md p-2">
					<div className="flex items-center gap-2 mb-1">
						<span className="text-[10px] font-mono text-slate-500">
							Attempt {index + 1}
						</span>
						<span className={statusBadgeClass(a.status)}>{a.status.toUpperCase()}</span>
						<span className="text-[10px] text-slate-600 ml-auto">
							{formatDurationMs(
								a.ended_at
									? new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()
									: null,
							)}
						</span>
					</div>
					{(a.failure_class || a.failure_signature) && (
						<div className="text-[11px] text-red-300/80 mb-1">
							{a.failure_class && <span className="font-mono">{a.failure_class}</span>}
							{a.failure_signature && (
								<span className="text-red-300/60 ml-2">
									{sanitizeDisplayText(a.failure_signature, 120)}
								</span>
							)}
						</div>
					)}
					{a.strategy_delta && (
						<div className="text-[11px] text-amber-300/80 mb-1">
							<span className="text-slate-500 mr-1">Strategy Delta:</span>
							{sanitizeDisplayText(a.strategy_delta, 160)}
						</div>
					)}
					{a.new_evidence && (
						<div className="text-[11px] text-slate-400 mb-1">
							<span className="text-slate-500 mr-1">New Evidence:</span>
							{sanitizeDisplayText(a.new_evidence, 160)}
						</div>
					)}
					<div className="flex flex-wrap gap-3">
						<FingerprintValue label="Input" value={a.input_fingerprint} />
						<FingerprintValue label="Output" value={a.output_fingerprint} />
					</div>
				</div>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Hauptkomponente
// ---------------------------------------------------------------------------

export default function MissionControlPanel({
	runId,
	runStatus,
}: MissionControlProps): React.ReactElement {
	const [state, setState] = useState<LoadState>({ kind: 'loading' });
	const [refreshTick, setRefreshTick] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const data = await api.getControlPlane(runId);
				if (cancelled) return;
				setState({ kind: 'ready', data });
			} catch (err) {
				if (cancelled) return;
				const message = err instanceof Error ? err.message : 'Unknown error';
				if (/not found|404/i.test(message)) {
					setState({ kind: 'not-found' });
				} else {
					setState({ kind: 'error', message });
				}
			}
		};
		void load();
		const timer = setInterval(() => setRefreshTick((t) => t + 1), POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [runId]);

	useEffect(() => {
		if (refreshTick === 0) return;
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const data = await api.getControlPlane(runId);
				if (!cancelled) setState({ kind: 'ready', data });
			} catch (err) {
				if (cancelled) return;
				const message = err instanceof Error ? err.message : 'Unknown error';
				if (/not found|404/i.test(message)) {
					setState({ kind: 'not-found' });
				} else {
					setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'error', message }));
				}
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [refreshTick, runId]);

	if (state.kind === 'loading') {
		return (
			<div className="card mb-6">
				<h3 className="text-sm font-medium text-slate-300 mb-2">Mission Control</h3>
				<p className="text-xs text-slate-500">Loading control-plane state…</p>
			</div>
		);
	}

	if (state.kind === 'not-found') {
		return (
			<div className="card mb-6 border-amber-800">
				<h3 className="text-sm font-medium text-slate-300 mb-2">Mission Control</h3>
				<p className="text-xs text-amber-300">
					Control-plane state unavailable for this run (run not found or pre-P2 run).
				</p>
			</div>
		);
	}

	if (state.kind === 'error') {
		return (
			<div className="card mb-6 border-yellow-800">
				<h3 className="text-sm font-medium text-slate-300 mb-2">Mission Control</h3>
				<p className="text-xs text-yellow-300">
					Backend temporarily unavailable: {sanitizeDisplayText(state.message, 140)}
				</p>
			</div>
		);
	}

	const data = state.data;
	const execution = currentExecution(data);
	const planJob = jobOfType(data, 'plan_gate') ?? jobOfType(data, 'plan');
	const buildAttempts = attemptsOfJob(data, 'build');
	const verifyChecks = verifyChecksOf(data);
	const research = researchStatusOf(data);
	const decision = latestDecision(data);
	const reviewAttempts = attemptsOfJob(data, 'review');
	const researchAttempts = attemptsOfJob(data, 'research');
	const timeline = data.transitions;
	// Verdicts kommen aus der persistierten Decision-Basis — niemals
	// clientseitig berechnet oder behauptet
	const reviewVerdict = decision ? extractBasisValue(decision, 'parallelism') : null;
	const researchVerdict =
		researchAttempts.length > 0 ? extractBasisValue(decision, 'research_parallelism') : null;
	const isSecurityBlocked = decision?.reason_code === 'SECURITY_BLOCK';

	return (
		<div className="card mb-6" data-testid="mission-control">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
					Mission Control
					{runStatus === 'active' && (
						<span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
					)}
				</h3>
				<span className="text-[10px] text-slate-600 font-mono">{data.run_id.slice(0, 12)}</span>
			</div>

			{isSecurityBlocked && (
				<div
					className="mb-3 p-3 bg-red-900/50 border border-red-700 rounded-lg"
					data-testid="security-block-banner"
				>
					<p className="text-xs font-bold text-red-300">
						SECURITY HARD BLOCK — run is BLOCKED (no majority vote)
					</p>
					<p className="text-[11px] text-red-300/80 mt-1 font-mono">
						reason_code: {decision?.reason_code}
					</p>
				</div>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
				{/* Spalte 1: Run / Execution / Decision */}
				<div className="space-y-3">
					<Section title="Run">
						<KeyValue label="run_id" value={<code className="text-[10px]">{data.run_id}</code>} />
						<KeyValue label="jobs" value={data.jobs.length} />
						<KeyValue label="attempts" value={data.attempts.length} />
						{execution && (
							<>
								<KeyValue label="current job" value={<code className="text-[11px]">{execution.job.job_type}</code>} />
								<KeyValue
									label="job state"
									value={<span className={statusColorClass(execution.job.state)}>{execution.job.state.toUpperCase()}</span>}
								/>
								<KeyValue label="attempts on job" value={execution.attempts.length} />
							</>
						)}
					</Section>

					<Section title="Decision">
						{decision ? (
							<>
								<KeyValue
									label="decision"
									value={
										<span className={`font-bold ${statusColorClass(decision.decision)}`}>
											{decision.decision}
										</span>
									}
								/>
								<KeyValue label="reason_code" value={<code className="text-[11px]">{decision.reason_code}</code>} />
								<KeyValue label="at" value={formatTimestamp(decision.created_at)} />
							</>
						) : (
							<p className="text-xs text-slate-500">No decision recorded yet.</p>
						)}
					</Section>

					<Section title="Plan Gate">
						{planJob ? (
							<>
								<KeyValue
									label="gate job"
									value={
										<span className={statusColorClass(planJob.state)}>
											{planJob.state.toUpperCase()}
										</span>
									}
								/>
								<KeyValue
									label="verdict"
									value={
										<span className="font-mono text-[11px]">
											{timeline.find((t) => t.new_state === 'PLAN_GATE')?.reason_code ??
												'—'}
										</span>
									}
								/>
							</>
						) : (
							<p className="text-xs text-slate-500">No plan gate job yet.</p>
						)}
					</Section>
				</div>

				{/* Spalte 2: Research / Build / Verify / Reviews */}
				<div className="space-y-3">
					<Section title="Research">
						{research.statuses.length === 0 ? (
							<p className="text-xs text-slate-500">No research job recorded.</p>
						) : (
							<>
								<div className="space-y-1 mb-1">
									{research.statuses.map((r) => (
										<div key={r.kind} className="flex items-center justify-between text-xs">
											<span className="font-mono text-slate-300">{r.kind}</span>
											<span className={statusBadgeClass(r.status)}>{r.status.toUpperCase()}</span>
										</div>
									))}
								</div>
								<KeyValue label="parallelism" value={<code className="text-[11px]">{researchVerdict ?? '—'}</code>} />
								{researchAttempts.length > 0 && (
									<KeyValue
										label="started"
										value={formatTimestamp(researchAttempts[0]?.started_at ?? null)}
									/>
								)}
							</>
						)}
					</Section>

					<Section title="Build">
						{buildAttempts.length === 0 ? (
							<p className="text-xs text-slate-500">No build attempts yet.</p>
						) : (
							<>
								{(() => {
									const last = buildAttempts.at(-1)!;
									return (
										<>
											<KeyValue label="worker" value={<code className="text-[11px]">{last.worker_type ?? '—'}</code>} />
											<KeyValue label="provider" value={<code className="text-[11px]">{last.provider ?? '—'}</code>} />
											<KeyValue label="model" value={<code className="text-[11px]">{last.model ?? '—'}</code>} />
											<KeyValue
												label="status"
												value={<span className={statusColorClass(last.status)}>{last.status.toUpperCase()}</span>}
											/>
											<KeyValue label="attempts" value={buildAttempts.length} />
											<div className="flex flex-wrap gap-3 mt-1">
												<FingerprintValue label="Input" value={last.input_fingerprint} />
												<FingerprintValue label="Output" value={last.output_fingerprint} />
											</div>
										</>
									);
								})()}
							</>
						)}
					</Section>

					<Section title="Verify">
						{verifyChecks.length === 0 ? (
							<p className="text-xs text-slate-500">No verify gates recorded.</p>
						) : (
							<div className="space-y-1">
								{verifyChecks.map((c, i) => (
									<div key={`${c.name}-${i}`} className="flex items-center justify-between text-xs">
										<span className="text-slate-300 truncate">{c.name}</span>
										<span className={c.passed ? 'text-green-400' : 'text-red-400'}>
											{c.passed ? 'PASS' : 'FAIL'}
										</span>
									</div>
								))}
							</div>
						)}
					</Section>

					<Section title="Reviews">
						{reviewAttempts.length === 0 ? (
							<p className="text-xs text-slate-500">No review workers recorded.</p>
						) : (
							<>
								<div className="space-y-1 mb-1">
									{reviewAttempts.map((a) => (
										<div key={a.attempt_id} className="flex items-center justify-between text-xs">
											<span className="font-mono text-slate-300">
												{(a.worker_type ?? 'review').replace('review-worker:', '')}
											</span>
											<span className={statusBadgeClass(a.status)}>{a.status.toUpperCase()}</span>
										</div>
									))}
								</div>
								<KeyValue label="parallelism" value={<code className="text-[11px]">{reviewVerdict ?? '—'}</code>} />
							</>
						)}
					</Section>
				</div>

				{/* Spalte 3: Timeline + Attempts */}
				<div className="space-y-3">
					<Section title="Run Timeline">
						<RunTimeline transitions={timeline} />
					</Section>

					<Section title="Attempt History (Build)">
						<AttemptHistory attempts={buildAttempts} />
					</Section>

					<Section title="Attempt History (Research)">
						<AttemptHistory attempts={researchAttempts} />
					</Section>
				</div>
			</div>
		</div>
	);
}

/**
 * Extrahiert einen Wert aus der persistierten Decision-Basis (Backend-Fakt).
 * basis.parallelism (P1-Review-Verdict) und basis.research_parallelism
 * (P2-Research-Verdict) werden getrennt gehalten.
 */
function extractBasisValue(
	decision: ControlPlaneDecision | null,
	key: 'parallelism' | 'research_parallelism',
): string | null {
	if (!decision?.contract) return null;
	try {
		const parsed = JSON.parse(decision.contract) as { basis?: Record<string, unknown> };
		const value = parsed.basis?.[key];
		return typeof value === 'string' ? value : null;
	} catch {
		return null;
	}
}
