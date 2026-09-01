import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/doctor.sh');

function runDoctor(args: string[], env: Record<string, string> = {}) {
	try {
		return {
			code: 0,
			stdout: execFileSync('/usr/bin/env', ['bash', script, ...args], {
				env: { ...process.env, ...env },
				encoding: 'utf8',
			}),
		};
	} catch (error) {
		const failure = error as { status?: number; stdout?: string; stderr?: string };
		return { code: failure.status ?? 1, stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
	}
}

function fakeBin(commands: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'positron-doctor-'));
	for (const [name, body] of Object.entries(commands)) {
		const path = join(dir, name);
		writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
		chmodSync(path, 0o755);
	}
	return dir;
}

describe('positron install doctor', () => {
	it('passes demo with minimum requirements and does not require OpenCode', () => {
		const result = runDoctor(['--demo'], {
			POSITRON_DOCTOR_WEB_URL: 'http://127.0.0.1:9',
			POSITRON_DOCTOR_API_URL: 'http://127.0.0.1:9',
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('DEMO_READINESS');
		expect(result.stdout).toContain('DEMO_READY');
		expect(result.stdout).toContain('OPENCODE_OPTIONAL');
	});

	it('reports missing Docker with an actionable reason', () => {
		const dir = fakeBin({ docker: 'exit 127' });
		const result = runDoctor(['--demo'], {
			PATH: `${dir}:/usr/bin:/bin`,
			POSITRON_DOCTOR_WEB_URL: 'http://127.0.0.1:9',
			POSITRON_DOCTOR_API_URL: 'http://127.0.0.1:9',
		});
		expect(result.code).toBe(1);
		expect(result.stdout).toContain('DOCKER_DAEMON_UNAVAILABLE');
		expect(result.stdout).toContain('Start Docker');
	});

	it('reports missing Compose v2 without installing anything', () => {
		const dir = fakeBin({ docker: 'if [[ "$1" == info ]]; then exit 0; fi; exit 1' });
		const result = runDoctor(['--demo'], {
			PATH: `${dir}:/usr/bin:/bin`,
			POSITRON_DOCTOR_WEB_URL: 'http://127.0.0.1:9',
			POSITRON_DOCTOR_API_URL: 'http://127.0.0.1:9',
		});
		expect(result.code).toBe(1);
		expect(result.stdout).toContain('COMPOSE_V2_NOT_FOUND');
	});

	it('reports a port conflict with reason, impact, and remediation', () => {
		const dir = fakeBin({ docker: 'exit 1', curl: 'exit 0' });
		const result = runDoctor(['--demo'], {
			PATH: `${dir}:/usr/bin:/bin`,
			POSITRON_DOCTOR_WEB_URL: 'http://occupied.test',
			POSITRON_DOCTOR_API_URL: 'http://occupied.test',
		});
		expect(result.code).toBe(1);
		expect(result.stdout).toContain('PORT_IN_USE');
		expect(result.stdout).toContain('Stop the service using the demo port');
	});

	it('emits deterministic secret-free JSON for supervised blockers', () => {
		const env = {
			PATH: '/usr/bin:/bin',
			POSITRON_DOCTOR_WEB_URL: 'http://127.0.0.1:9',
			POSITRON_DOCTOR_API_URL: 'http://127.0.0.1:9',
			GITHUB_TOKEN: 'ghp-super-secret',
			POSITRON_OPENCODE_PROVIDER: 'provider-value',
			POSITRON_OPENCODE_MODEL: 'model-value',
			POSITRON_REPO_OWNER: 'owner-value',
			POSITRON_REPO_NAME: 'repo-value',
		};
		const first = runDoctor(['--supervised', '--json'], env);
		const second = runDoctor(['--supervised', '--json'], env);
		expect(first.code).toBe(1);
		expect(first.stdout).toBe(second.stdout);
		const report = JSON.parse(first.stdout) as {
			version: string;
			overall_status: string;
			checks: Array<{ reason_code: string }>;
		};
		expect(report.version).toBe('positron.install-doctor.v1');
		expect(report.overall_status).toBe('BLOCKED');
		expect(report.checks.map((check) => check.reason_code)).toContain('PROVIDER_CONFIGURED');
		expect(first.stdout).not.toContain('ghp-super-secret');
		expect(first.stdout).not.toContain('provider-value');
		expect(first.stdout).not.toContain('model-value');
	});

	it('reports missing supervised OpenCode, provider, and repository configuration', () => {
		const result = runDoctor(['--supervised', '--json'], {
			PATH: '/usr/bin:/bin',
			POSITRON_DOCTOR_WEB_URL: 'http://127.0.0.1:9',
			POSITRON_DOCTOR_API_URL: 'http://127.0.0.1:9',
		});
		const report = JSON.parse(result.stdout) as {
			checks: Array<{ reason_code: string; next_action: string }>;
		};
		const codes = report.checks.map((check) => check.reason_code);
		expect(codes).toEqual(
			expect.arrayContaining([
				'OPENCODE_NOT_FOUND',
				'PROVIDER_NOT_CONFIGURED',
				'REPOSITORY_NOT_CONFIGURED',
			]),
		);
		expect(report.checks.some((check) => check.next_action.includes('rerun'))).toBe(true);
	});

	it('does not enable mutation flags or change credentials', () => {
		const result = runDoctor(['--supervised', '--json'], {
			PATH: '/usr/bin:/bin',
			POSITRON_ENABLE_PUSH: 'true',
			POSITRON_ENABLE_MERGE: 'true',
			POSITRON_ENABLE_REAL: 'true',
			POSITRON_DOCTOR_WEB_URL: 'http://127.0.0.1:9',
			POSITRON_DOCTOR_API_URL: 'http://127.0.0.1:9',
		});
		expect(result.code).toBe(1);
		expect(result.stdout).toContain('UNSAFE_MUTATION_FLAG');
		expect(result.stdout).toContain('Disable real/push/merge flags');
	});
});
