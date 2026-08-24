// Positron P5.4 — Shadow & Canary
//
// Shadow darf reale Aufgaben evaluieren, aber niemals Production Pointer mutieren.
// Canary ist begrenzt mit Kill Switch.

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { getProductionPointer } from './production-pointer.js';

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------

export interface ShadowRun {
	shadow_run_id: string;
	candidate_id: string;
	baseline_ref: Record<string, unknown>;
	candidate_ref: Record<string, unknown>;
	result_metrics: Record<string, unknown>;
	profile_fingerprints: { before: string; after: string };
	production_pointer_before: string;
	production_pointer_after: string;
	created_at: string;
}

export interface ShadowResult {
	shadow_run_id: string;
	noMutation: boolean;
	beforeFingerprint: string;
	afterFingerprint: string;
}

export function runShadow(
	db: Database.Database,
	input: {
		candidate_id: string;
		baseline_ref: Record<string, unknown>;
		candidate_ref: Record<string, unknown>;
		result_metrics: Record<string, unknown>;
	},
): ShadowResult {
	const before = getProductionPointer(db);
	const beforeFp = before?.profile_fingerprint ?? 'NO_POINTER';

	// Shadow execution: do NOT mutate pointer, just record
	const shadowRunId = `shadow-${crypto.randomUUID()}`;
	const now = new Date().toISOString();

	// Simulate candidate execution without touching production pointer
	// In real implementation, this would run the candidate profile in isolation

	const after = getProductionPointer(db);
	const afterFp = after?.profile_fingerprint ?? 'NO_POINTER';

	const noMutation = beforeFp === afterFp;

	db.prepare(
		`INSERT INTO cp_shadow_runs (shadow_run_id, candidate_id, baseline_ref, candidate_ref, result_metrics, profile_fingerprints, production_pointer_before, production_pointer_after, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		shadowRunId,
		input.candidate_id,
		JSON.stringify(input.baseline_ref),
		JSON.stringify(input.candidate_ref),
		JSON.stringify(input.result_metrics),
		JSON.stringify({ before: beforeFp, after: afterFp }),
		beforeFp,
		afterFp,
		now,
	);

	return {
		shadow_run_id: shadowRunId,
		noMutation,
		beforeFingerprint: beforeFp,
		afterFingerprint: afterFp,
	};
}

export function getShadowRuns(db: Database.Database, candidateId: string): ShadowRun[] {
	return (
		db
			.prepare('SELECT * FROM cp_shadow_runs WHERE candidate_id = ? ORDER BY created_at ASC')
			.all(candidateId) as Record<string, unknown>[]
	).map((row) => ({
		shadow_run_id: row.shadow_run_id as string,
		candidate_id: row.candidate_id as string,
		baseline_ref: JSON.parse(row.baseline_ref as string),
		candidate_ref: JSON.parse(row.candidate_ref as string),
		result_metrics: JSON.parse(row.result_metrics as string),
		profile_fingerprints: JSON.parse(row.profile_fingerprints as string),
		production_pointer_before: row.production_pointer_before as string,
		production_pointer_after: row.production_pointer_after as string,
		created_at: row.created_at as string,
	}));
}

// ---------------------------------------------------------------------------
// Canary (Bounded)
// ---------------------------------------------------------------------------

export interface CanaryBounds {
	max_runs: number;
	max_attempts: number;
	max_duration_ms: number;
	max_provider_capacity: number;
	max_budget: number;
	traffic_fraction: number;
	kill_switch_enabled: boolean;
}

export interface CanaryRun {
	canary_run_id: string;
	candidate_id: string;
	bounds: CanaryBounds;
	status: 'RUNNING' | 'PASSED' | 'STOPPED' | 'FAILED';
	metrics: Record<string, unknown>;
	kill_switch_triggered: boolean;
	created_at: string;
	ended_at: string | null;
}

export const CANARY_BOUNDED = 'CANARY_BOUNDED';
export const CANARY_KILL_SWITCH = 'CANARY_KILL_SWITCH';
export const CANARY_STOPPED = 'CANARY_STOPPED';

export function startCanary(
	db: Database.Database,
	input: {
		candidate_id: string;
		bounds: CanaryBounds;
	},
): CanaryRun {
	const canaryRunId = `canary-${crypto.randomUUID()}`;
	const now = new Date().toISOString();

	db.prepare(
		`INSERT INTO cp_canary_runs (canary_run_id, candidate_id, bounds, status, metrics, kill_switch_triggered, created_at, ended_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		canaryRunId,
		input.candidate_id,
		JSON.stringify(input.bounds),
		'RUNNING',
		JSON.stringify({}),
		0,
		now,
		null,
	);

	return {
		canary_run_id: canaryRunId,
		candidate_id: input.candidate_id,
		bounds: input.bounds,
		status: 'RUNNING',
		metrics: {},
		kill_switch_triggered: false,
		created_at: now,
		ended_at: null,
	};
}

export function checkCanaryKillSwitch(
	_db: Database.Database,
	_canaryRunId: string,
	signals: {
		securityRegression?: boolean;
		criticalRegression?: boolean;
		repeatedFailure?: boolean;
		budgetExceeded?: boolean;
		capacityExceeded?: boolean;
		invariantViolation?: boolean;
	},
): { shouldStop: boolean; reason: string } {
	if (signals.securityRegression) return { shouldStop: true, reason: 'SECURITY_REGRESSION' };
	if (signals.criticalRegression) return { shouldStop: true, reason: 'CRITICAL_REGRESSION' };
	if (signals.repeatedFailure) return { shouldStop: true, reason: 'REPEATED_FAILURE' };
	if (signals.budgetExceeded) return { shouldStop: true, reason: 'BUDGET_EXCEEDED' };
	if (signals.capacityExceeded) return { shouldStop: true, reason: 'CAPACITY_EXCEEDED' };
	if (signals.invariantViolation) return { shouldStop: true, reason: 'INVARIANT_VIOLATION' };
	return { shouldStop: false, reason: 'NO_KILL_SWITCH' };
}

export function stopCanary(
	db: Database.Database,
	canaryRunId: string,
	reason: string,
	killSwitchTriggered: boolean,
): void {
	const now = new Date().toISOString();
	db.prepare(
		'UPDATE cp_canary_runs SET status = ?, metrics = ?, kill_switch_triggered = ?, ended_at = ? WHERE canary_run_id = ?',
	).run(
		'STOPPED',
		JSON.stringify({ stop_reason: reason }),
		killSwitchTriggered ? 1 : 0,
		now,
		canaryRunId,
	);
}

export function completeCanary(
	db: Database.Database,
	canaryRunId: string,
	metrics: Record<string, unknown>,
): void {
	const now = new Date().toISOString();
	db.prepare(
		'UPDATE cp_canary_runs SET status = ?, metrics = ?, ended_at = ? WHERE canary_run_id = ?',
	).run('PASSED', JSON.stringify(metrics), now, canaryRunId);
}

export function getCanaryRuns(db: Database.Database, candidateId: string): CanaryRun[] {
	return (
		db
			.prepare('SELECT * FROM cp_canary_runs WHERE candidate_id = ? ORDER BY created_at ASC')
			.all(candidateId) as Record<string, unknown>[]
	).map((row) => ({
		canary_run_id: row.canary_run_id as string,
		candidate_id: row.candidate_id as string,
		bounds: JSON.parse(row.bounds as string),
		status: row.status as CanaryRun['status'],
		metrics: JSON.parse(row.metrics as string),
		kill_switch_triggered: Boolean(row.kill_switch_triggered),
		created_at: row.created_at as string,
		ended_at: row.ended_at as string | null,
	}));
}

export function isCanaryBounded(bounds: CanaryBounds): boolean {
	return (
		bounds.max_runs > 0 &&
		bounds.max_runs <= 100 &&
		bounds.max_attempts > 0 &&
		bounds.max_attempts <= 1000 &&
		bounds.max_duration_ms > 0 &&
		bounds.max_duration_ms <= 3600000 &&
		bounds.traffic_fraction > 0 &&
		bounds.traffic_fraction <= 1
	);
}
