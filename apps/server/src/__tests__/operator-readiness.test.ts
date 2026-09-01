import { describe, expect, it } from 'vitest';
import { buildOperatorReadiness } from '../readiness.js';

const base = {
	ready: true,
	checks: { database: true, schema: true, integrity: true },
};

describe('positron.operator-readiness.v1', () => {
	it('reports a safe demo-ready state without claiming real readiness', () => {
		const result = buildOperatorReadiness({
			durable: base,
			githubMode: 'fake',
			opencode: { available: true, version: 'fixture' },
			repository: { owner: 'demo', repo: 'repo' },
			safety: { killSwitch: true, enablePush: false },
			now: '2026-09-01T00:00:00.000Z',
		});
		expect(result).toMatchObject({
			contract: 'positron.operator-readiness.v1',
			overall_status: 'READY_DEMO',
		});
		expect(result.security_policy.reason_code).toBe('SAFETY_GATE_DISABLED');
		expect(result.last_checked_at).toBeUndefined();
	});

	it('fails closed with an actionable OpenCode reason', () => {
		const result = buildOperatorReadiness({
			durable: base,
			githubMode: 'real',
			opencode: { available: false, reason: 'binary missing' },
			repository: { owner: 'demo', repo: 'repo' },
			safety: { killSwitch: true, enablePush: false },
		});
		expect(result.overall_status).toBe('BLOCKED');
		expect(result.opencode).toMatchObject({
			status: 'BLOCKED',
			reason_code: 'EXECUTABLE_NOT_FOUND',
		});
	});
});
