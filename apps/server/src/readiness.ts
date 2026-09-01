import type Database from 'better-sqlite3';

export interface ReadinessResult {
	ready: boolean;
	reason?: string;
	checks: { database: boolean; schema: boolean; integrity: boolean };
}

export type OperatorReadinessStatus =
	| 'READY_DEMO'
	| 'READY_SUPERVISED'
	| 'BLOCKED'
	| 'NEEDS_CONFIGURATION'
	| 'UNAVAILABLE'
	| 'UNKNOWN';

export interface OperatorReadinessCheck {
	status: OperatorReadinessStatus;
	reason_code: string;
	human_message: string;
	remediation_hint: string;
	evidence_ref: string;
	last_checked_at: string;
}

export interface OperatorReadinessResponse {
	contract: 'positron.operator-readiness.v1';
	overall_status: OperatorReadinessStatus;
	server: OperatorReadinessCheck;
	database: OperatorReadinessCheck;
	workspace: OperatorReadinessCheck;
	git: OperatorReadinessCheck;
	github: OperatorReadinessCheck;
	opencode: OperatorReadinessCheck;
	provider: OperatorReadinessCheck;
	model: OperatorReadinessCheck;
	repository: OperatorReadinessCheck;
	security_policy: OperatorReadinessCheck;
	runtime_budget: OperatorReadinessCheck;
	approval_system: OperatorReadinessCheck;
	next_action: { label: string; href: string };
}

type AdapterHealth = { available: boolean; version?: string; reason?: string };

export function buildOperatorReadiness(input: {
	durable: ReadinessResult;
	githubMode: 'fake' | 'real';
	opencode: AdapterHealth;
	repository: { owner: string; repo: string };
	safety: { killSwitch: boolean; enablePush: boolean };
	now?: string;
}): OperatorReadinessResponse {
	const now = input.now ?? new Date().toISOString();
	const check = (
		status: OperatorReadinessStatus,
		reason_code: string,
		human_message: string,
		remediation_hint: string,
		evidence_ref: string,
	): OperatorReadinessCheck => ({
		status,
		reason_code,
		human_message,
		remediation_hint,
		evidence_ref,
		last_checked_at: now,
	});
	const durableStatus = input.durable.ready ? 'READY_DEMO' : 'BLOCKED';
	const database = check(
		durableStatus,
		input.durable.ready ? 'DURABLE_STATE_READY' : 'DURABLE_STATE_UNAVAILABLE',
		input.durable.ready
			? 'Durable control-plane state is ready.'
			: (input.durable.reason ?? 'Durable state is not ready.'),
		input.durable.ready
			? 'No action required.'
			: 'Restart with a writable database and complete migrations.',
		'/api/readiness',
	);
	const server = check(
		'READY_DEMO',
		'SERVER_RESPONDING',
		'Positron server is responding.',
		'No action required.',
		'/api/health',
	);
	const workspace = check(
		'READY_DEMO',
		'WORKSPACE_CONFIGURED',
		'A workspace is available for local execution.',
		'No action required.',
		'POSITRON_WORKSPACE_ROOT',
	);
	const git = check(
		'READY_DEMO',
		'GIT_AVAILABLE',
		'Git is available to manage isolated workspaces.',
		'No action required.',
		'git runtime',
	);
	const github =
		input.githubMode === 'fake'
			? check(
					'READY_DEMO',
					'FAKE_ADAPTER_ACTIVE',
					'Demo GitHub adapter is active; no external repository is changed.',
					'Use Settings to review real-mode configuration before supervised work.',
					'/api/health',
				)
			: check(
					'READY_SUPERVISED',
					'GITHUB_ADAPTER_ACTIVE',
					'GitHub adapter is configured for supervised work.',
					'Confirm repository access before starting a run.',
					'/api/health',
				);
	const opencode = input.opencode.available
		? check(
				input.githubMode === 'fake' ? 'READY_DEMO' : 'READY_SUPERVISED',
				'EXECUTABLE_READY',
				`OpenCode ${input.opencode.version ?? 'executable'} is available.`,
				'No action required.',
				'/api/adapters/health',
			)
		: check(
				'BLOCKED',
				'EXECUTABLE_NOT_FOUND',
				'OpenCode executable was not found.',
				'Install OpenCode and restart Positron.',
				'/api/adapters/health',
			);
	const provider = input.opencode.available
		? check(
				input.githubMode === 'fake' ? 'READY_DEMO' : 'READY_SUPERVISED',
				'PROVIDER_RESOLVABLE',
				'The configured provider path is available.',
				'No action required.',
				'/api/adapters/health',
			)
		: check(
				'UNAVAILABLE',
				'PROVIDER_UNAVAILABLE',
				input.opencode.reason ?? 'Provider runtime is unavailable.',
				'Make a supported provider available, then refresh readiness.',
				'/api/adapters/health',
			);
	const model = check(
		input.githubMode === 'fake' ? 'READY_DEMO' : 'NEEDS_CONFIGURATION',
		input.githubMode === 'fake' ? 'DEMO_MODEL' : 'MODEL_CONFIGURATION_REQUIRED',
		input.githubMode === 'fake'
			? 'Demo model path is selected.'
			: 'A real provider model must be explicitly configured.',
		'Review provider and model configuration before a supervised run.',
		'/api/settings/test-modes',
	);
	const repository = check(
		'NEEDS_CONFIGURATION',
		'REPOSITORY_NOT_SELECTED',
		`No repository is selected for ${input.repository.owner}/${input.repository.repo}.`,
		'Add a repository in Repositories before starting a run.',
		'/api/repos',
	);
	const securityBlocked = input.safety.killSwitch || !input.safety.enablePush;
	const security = securityBlocked
		? check(
				'BLOCKED',
				'SAFETY_GATE_DISABLED',
				'Supervised issue-to-PR execution is blocked by safety gates.',
				'Keep gates disabled for demo work; an administrator must explicitly configure supervised access.',
				'/api/safety',
			)
		: check(
				'READY_SUPERVISED',
				'SAFETY_GATE_CONFIGURED',
				'Required supervised safety gates are configured.',
				'No action required.',
				'/api/safety',
			);
	const runtime = check(
		input.durable.ready ? 'READY_DEMO' : 'BLOCKED',
		input.durable.ready ? 'RUNTIME_HEALTHY' : 'RUNTIME_STATE_UNAVAILABLE',
		input.durable.ready
			? 'Runtime health checks can accept bounded work.'
			: 'Runtime health cannot accept work.',
		input.durable.ready ? 'No action required.' : 'Resolve durable state readiness first.',
		'/api/readiness',
	);
	const approval = check(
		'READY_DEMO',
		'APPROVAL_SYSTEM_AVAILABLE',
		'Approval gates are available and remain human-controlled.',
		'No action required.',
		'/api/runs/:id/gate',
	);
	const checks = [database, opencode, provider, model, repository, security, runtime, approval];
	const overall_status =
		input.githubMode === 'fake' && input.durable.ready
			? 'READY_DEMO'
			: checks.some((item) => item.status === 'BLOCKED' || item.status === 'UNAVAILABLE')
				? 'BLOCKED'
				: checks.some((item) => item.status === 'NEEDS_CONFIGURATION')
					? 'NEEDS_CONFIGURATION'
					: 'READY_SUPERVISED';
	return {
		contract: 'positron.operator-readiness.v1',
		overall_status,
		server,
		database,
		workspace,
		git,
		github,
		opencode,
		provider,
		model,
		repository,
		security_policy: security,
		runtime_budget: runtime,
		approval_system: approval,
		next_action:
			overall_status === 'READY_DEMO'
				? { label: 'Start a safe demo run', href: '/' }
				: { label: 'Review configuration', href: '/settings' },
	};
}

/** Readiness is deliberately stricter than /api/health (which means alive). */
export function checkReadiness(db: Database.Database): ReadinessResult {
	try {
		const integrity = db.pragma('integrity_check', { simple: true }) === 'ok';
		const hasRuns =
			db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() !==
			undefined;
		const migration = db.prepare("SELECT value FROM cp_kv WHERE key = 'migration_version'").get() as
			| { value?: string }
			| undefined;
		const schema = hasRuns && migration?.value === '12';
		const ready = integrity && schema;
		return {
			ready,
			reason: ready ? undefined : 'persistent control-plane state is not ready',
			checks: { database: true, schema, integrity },
		};
	} catch {
		return {
			ready: false,
			reason: 'persistent control-plane state is unavailable',
			checks: { database: false, schema: false, integrity: false },
		};
	}
}
