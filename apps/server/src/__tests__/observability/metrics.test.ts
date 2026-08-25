/**
 * Tests for Prometheus /metrics endpoint (QA-010).
 * Validates: endpoint reachable, Prometheus format, no secrets, no high-cardinality labels.
 */

import type { Server } from 'node:http';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../../index.js';

let server: Server;
let port: number;

beforeAll(async () => {
	// Required env vars for server startup in test
	process.env.POSITRON_REPO_OWNER = 'test-owner';
	process.env.POSITRON_REPO_NAME = 'test-repo';
	process.env.POSITRON_GITHUB_MODE = 'fake';

	server = createServer({ dbPath: ':memory:' });
	await new Promise<void>((resolve) => {
		server.listen(0, () => {
			port = (server.address() as { port: number }).port;
			resolve();
		});
	});
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fetchMetrics(): Promise<{
	status: number;
	body: string;
	contentType: string | null;
}> {
	return new Promise((resolve, reject) => {
		http
			.get(`http://localhost:${port}/metrics`, (res) => {
				let body = '';
				res.on('data', (chunk) => {
					body += chunk;
				});
				res.on('end', () => {
					resolve({
						status: res.statusCode ?? 0,
						body,
						contentType: res.headers['content-type'] ?? null,
					});
				});
			})
			.on('error', reject);
	});
}

describe('/metrics endpoint', () => {
	it('returns HTTP 200', async () => {
		const result = await fetchMetrics();
		expect(result.status).toBe(200);
	});

	it('returns Prometheus content type', async () => {
		const result = await fetchMetrics();
		expect(result.contentType).toMatch(/text\/plain/);
	});

	it('contains expected metric names', async () => {
		const result = await fetchMetrics();
		expect(result.body).toContain('positron_runs_total');
		expect(result.body).toContain('positron_run_duration_seconds');
		expect(result.body).toContain('positron_run_failures_total');
		expect(result.body).toContain('positron_retries_total');
		expect(result.body).toContain('positron_cancellations_total');
		expect(result.body).toContain('positron_github_api_requests_total');
		expect(result.body).toContain('positron_github_api_failures_total');
		expect(result.body).toContain('positron_github_api_duration_seconds');
		expect(result.body).toContain('positron_github_rate_limit_hits_total');
		expect(result.body).toContain('positron_opencode_command_total');
		expect(result.body).toContain('positron_opencode_command_duration_seconds');
		expect(result.body).toContain('positron_opencode_command_failures_total');
		expect(result.body).toContain('positron_blocked_merges_total');
		expect(result.body).toContain('positron_blocked_pushes_total');
		expect(result.body).toContain('positron_gate_revisions_total');
	});

	it('does not contain secret patterns', async () => {
		const result = await fetchMetrics();
		expect(result.body).not.toMatch(/ghp_/);
		expect(result.body).not.toMatch(/gho_/);
		expect(result.body).not.toMatch(/github_pat_/);
		expect(result.body).not.toMatch(/sk-ant-/);
		expect(result.body).not.toMatch(/AKIA/);
	});

	it('does not contain high-cardinality labels (no runId, issue number)', async () => {
		const result = await fetchMetrics();
		const lines = result.body.split('\n');
		for (const line of lines) {
			if (line.startsWith('#')) continue;
			if (line.includes('{') && line.includes('}')) {
				const labelSection = line.match(/\{([^}]*)\}/);
				if (labelSection) {
					const labels = labelSection[1];
					// No UUID-like patterns
					expect(labels).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
					// No branch-like patterns
					expect(labels).not.toMatch(/positron\/issue-/);
				}
			}
		}
	});

	it('metric names follow positron_ prefix convention', async () => {
		const result = await fetchMetrics();
		const metricNames = result.body
			.split('\n')
			.filter((line: string) => /^positron_/.test(line) && !line.startsWith('#'))
			.map((line: string) => line.match(/^(positron_\w+)/)?.[1])
			.filter(Boolean);

		expect(metricNames.length).toBeGreaterThan(0);
		for (const name of metricNames) {
			expect(name).toMatch(/^positron_[a-z_]+$/);
		}
	});
});
