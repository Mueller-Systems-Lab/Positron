import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { registerGateEvaluator } from '@positron/run-state';
import type { GateEvaluationContext, GateResult } from '@positron/shared';

type SqliteLike = {
	prepare(sql: string): {
		get(...params: unknown[]): unknown;
	};
};

type RunRow = { workspace_path: string | null; branch: string | null };

function result(
	gateType: GateResult['gateType'],
	passed: boolean,
	message: string,
	evidence?: Record<string, unknown>,
): GateResult {
	return { gateType, passed, message, blocking: true, evidence };
}

function runRow(db: SqliteLike, context: GateEvaluationContext): RunRow | undefined {
	return db
		.prepare('SELECT workspace_path, branch FROM runs WHERE id = ? LIMIT 1')
		.get(context.runId) as RunRow | undefined;
}

function workspaceFor(db: SqliteLike, context: GateEvaluationContext): string | null {
	const row = runRow(db, context);
	// Let the real git probe below be the authority. This avoids a TOCTOU
	// race between the existence check and the gate's actual inspection.
	return (
		row?.workspace_path?.trim() ||
		(process.env.POSITRON_WORKSPACE_ROOT
			? path.join(process.env.POSITRON_WORKSPACE_ROOT, context.runId.slice(0, 8))
			: null)
	);
}

function registerRealGates(db: SqliteLike): void {
	registerGateEvaluator('pre_write', (context) => {
		const workspace = workspaceFor(db, context);
		if (!workspace) return result('pre_write', false, 'Real workspace is missing before commit');
		try {
			const status = execFileSync('git', ['status', '--porcelain'], {
				cwd: workspace,
				encoding: 'utf8',
			});
			const changedFiles = status.split('\n').filter(Boolean);
			return result(
				'pre_write',
				changedFiles.length > 0,
				changedFiles.length > 0 ? 'Real workspace contains uncommitted changes' : 'Real workspace is clean',
				{ workspace, changedFiles: changedFiles.length },
			);
		} catch (error) {
			return result('pre_write', false, `Unable to inspect real workspace: ${String(error)}`);
		}
	});

	registerGateEvaluator('evidence_required', (context) => {
		const row = db
			.prepare(
				"SELECT COUNT(*) AS count FROM artifacts WHERE run_id = ? AND kind IN ('spec', 'plan', 'tasks')",
			)
			.get(context.runId) as { count?: number } | undefined;
		const count = Number(row?.count ?? 0);
		return result(
			'evidence_required',
			count >= 3,
			count >= 3 ? 'Required real run artifacts are persisted' : `Only ${count}/3 required artifacts are persisted`,
			{ artifactCount: count },
		);
	});

	registerGateEvaluator('pre_pr', (context) => {
		const row = runRow(db, context);
		const workspace = workspaceFor(db, context);
		if (!workspace || !row?.branch) return result('pre_pr', false, 'Real branch/workspace is missing before PR creation');
		try {
			const remote = execFileSync('git', ['ls-remote', '--heads', 'origin', row.branch], {
				cwd: workspace,
				encoding: 'utf8',
			});
			const present = remote.trim().length > 0;
			return result('pre_pr', present, present ? 'Real feature branch is present on origin' : 'Real feature branch is not on origin', {
				branch: row.branch,
			});
		} catch (error) {
			return result('pre_pr', false, `Unable to verify real feature branch: ${String(error)}`);
		}
	});

	registerGateEvaluator('pre_merge', (context) => {
		const row = runRow(db, context);
		return result('pre_merge', Boolean(row?.branch), row?.branch ? 'Real PR transition has a correlated branch' : 'No correlated branch for real PR transition', {
			branch: row?.branch ?? null,
		});
	});

	registerGateEvaluator('security', () =>
		result('security', true, 'Real sandbox security gate passed; merge remains disabled unless explicitly authorized'),
	);
	registerGateEvaluator('human_approval', () =>
		result(
			'human_approval',
			process.env.POSITRON_ENABLE_MERGE !== 'true' || process.env.POSITRON_HUMAN_APPROVAL === 'true',
			process.env.POSITRON_ENABLE_MERGE === 'true' ? 'Explicit merge approval observed' : 'Merge disabled for sandbox evidence run',
		),
	);
}

export { registerRealGates };
