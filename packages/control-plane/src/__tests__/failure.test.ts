// Positron Control Plane — Failure Classification Tests
// FAILURE_CLASSIFICATION: Provider-/Infra-Fehler ≠ Modellunfähigkeit

import { describe, expect, it } from 'vitest';
import { classifyFailure, failureSignatureFromChecks } from '../failure.js';

describe('FAILURE_CLASSIFICATION', () => {
	it('classifies provider rate-limit as PROVIDER_FAILURE', () => {
		const result = classifyFailure({
			stderr: 'Error: rate limit exceeded, retry after 60s',
			exitCode: 1,
		});
		expect(result.signature).toBe('PROVIDER_FAILURE');
	});

	it('classifies provider timeout as PROVIDER_FAILURE', () => {
		const result = classifyFailure({ stderr: 'request timed out after 120s', exitCode: 1 });
		expect(result.signature).toBe('PROVIDER_FAILURE');
	});

	it('classifies 429/5xx as PROVIDER_FAILURE', () => {
		expect(classifyFailure({ stderr: 'HTTP 429 Too Many Requests' }).signature).toBe(
			'PROVIDER_FAILURE',
		);
		expect(classifyFailure({ stderr: 'HTTP 503 Service Unavailable' }).signature).toBe(
			'PROVIDER_FAILURE',
		);
	});

	it('classifies missing workspace as INFRA_FAILURE', () => {
		const result = classifyFailure({ stderr: 'ENOENT: no such file or directory' });
		expect(result.signature).toBe('INFRA_FAILURE');
	});

	it('classifies git errors as INFRA_FAILURE', () => {
		const result = classifyFailure({ stderr: 'fatal: git error: not a git repository' });
		expect(result.signature).toBe('INFRA_FAILURE');
	});

	it('classifies test failures as TEST_FAILURE', () => {
		const result = classifyFailure({ exitCode: 1, stdout: '1 failed, 2 passed' });
		expect(result.signature).toBe('TEST_FAILURE');
	});

	it('classifies typecheck errors as TYPECHECK_FAILURE', () => {
		const result = classifyFailure({ stderr: 'tsc: error TS2322: Type mismatch' });
		expect(result.signature).toBe('TYPECHECK_FAILURE');
	});

	it('classifies lint errors as LINT_FAILURE', () => {
		const result = classifyFailure({ stderr: 'biome: lint error: noUnusedVariables' });
		expect(result.signature).toBe('LINT_FAILURE');
	});

	it('classifies build errors as BUILD_FAILURE', () => {
		const result = classifyFailure({ stderr: 'vite build failed: unexpected token' });
		expect(result.signature).toBe('BUILD_FAILURE');
	});

	it('classifies explicit timeout as TIMEOUT', () => {
		const result = classifyFailure({ timeout: true });
		expect(result.signature).toBe('TIMEOUT');
	});

	it('classifies contract errors as CONTRACT_FAILURE', () => {
		const result = classifyFailure({ contractError: true });
		expect(result.signature).toBe('CONTRACT_FAILURE');
	});

	it('classifies missing context artifacts as CONTEXT_FAILURE', () => {
		const result = classifyFailure({ contextMissing: ['plan', 'tasks'] });
		expect(result.signature).toBe('CONTEXT_FAILURE:plan,tasks');
	});

	it('classifies security patterns as SECURITY_BLOCK', () => {
		const result = classifyFailure({ stderr: 'credential leaked: api key found' });
		expect(result.signature).toBe('SECURITY_BLOCK');
	});

	it('respects explicit classification (highest priority)', () => {
		const result = classifyFailure({ explicit: 'PROVIDER_FAILURE', stderr: 'test failed' });
		expect(result.signature).toBe('PROVIDER_FAILURE');
	});

	it('falls back to UNKNOWN', () => {
		const result = classifyFailure({ exitCode: 0, stderr: '' });
		expect(result.signature).toBe('UNKNOWN');
	});

	it('exit code 0 with no output is not a failure', () => {
		const result = classifyFailure({ exitCode: 0 });
		expect(result.signature).toBe('UNKNOWN');
	});

	it('build failure is not classified as test failure', () => {
		const result = classifyFailure({
			stderr: 'npm run build failed with exit code 1',
			exitCode: 1,
		});
		expect(result.signature).toBe('BUILD_FAILURE');
	});
});

describe('failure signature stability', () => {
	it('same failed checks → same signature', () => {
		const a = failureSignatureFromChecks([{ name: 'sum.test.js', kind: 'unit' }]);
		const b = failureSignatureFromChecks([{ name: 'sum.test.js', kind: 'unit' }]);
		expect(a).toBe(b);
	});

	it('different failed checks → different signature', () => {
		const a = failureSignatureFromChecks([{ name: 'sum.test.js', kind: 'unit' }]);
		const b = failureSignatureFromChecks([{ name: 'other.test.js', kind: 'unit' }]);
		expect(a).not.toBe(b);
	});
});
