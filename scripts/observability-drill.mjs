#!/usr/bin/env node
/**
 * Positron Observability Drill Script (QA-016)
 *
 * Safe, local-only observability validation script.
 * Generates reproducible metric events without real GitHub writes.
 *
 * Usage:
 *   node scripts/observability-drill.mjs [--count=N] [--server=http://localhost:3000]
 *
 * Exit codes:
 *   0 — Drill completed successfully
 *   1 — Prerequisites not met
 */

import { Buffer } from 'node:buffer';
import http from 'node:http';

// ── Configuration ────────────────────────────────────────────────────────
const SERVER_URL = process.env.POSITRON_SERVER_URL ?? 'http://localhost:3000';
const RUN_COUNT = Number.parseInt(process.env.POSITRON_DRILL_COUNT ?? '10', 10);
const DELAY_MS = 500; // Delay between runs to allow pipeline progress

// ── Helpers ──────────────────────────────────────────────────────────────

function httpRequest(method, path, body = null) {
	return new Promise((resolve, reject) => {
		const url = new URL(path, SERVER_URL);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname + url.search,
			method,
			headers: body ? { 'Content-Type': 'application/json' } : {},
			timeout: 10000,
		};
		const req = http.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => {
				data += chunk;
			});
			res.on('end', () => {
				try {
					resolve({ status: res.statusCode, body: JSON.parse(data) });
				} catch {
					resolve({ status: res.statusCode, body: data });
				}
			});
		});
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('Request timeout'));
		});
		if (body) req.write(JSON.stringify(body));
		req.end();
	});
}

async function checkHealth() {
	try {
		const res = await httpRequest('GET', '/api/health');
		return res.status === 200 && res.body?.status === 'ok';
	} catch {
		return false;
	}
}

async function getMetric(name) {
	try {
		const res = await httpRequest('GET', '/metrics');
		const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
		const regex = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([\\d.e+]+)`, 'm');
		const match = text.match(regex);
		return match ? Number.parseFloat(match[1]) : null;
	} catch {
		return null;
	}
}

async function collectMetrics(metricNames) {
	const result = {};
	for (const name of metricNames) {
		result[name] = await getMetric(name);
	}
	return result;
}

function formatValue(val) {
	if (val === null) return 'N/A';
	if (typeof val === 'number') return val.toFixed(2);
	return String(val);
}

// ── Main Drill ────────────────────────────────────────────────────────────

async function main() {
	console.log('='.repeat(60));
	console.log(' Positron Observability Drill (QA-016)');
	console.log('='.repeat(60));
	console.log(` Server: ${SERVER_URL}`);
	console.log(` Runs to generate: ${RUN_COUNT}`);
	console.log('');

	// ── Step 1: Prerequisites check ─────────────────────────────────────────
	console.log('[1/4] Checking prerequisites...');
	const healthy = await checkHealth();
	if (!healthy) {
		console.error('  ❌ Positron server is not reachable at', SERVER_URL);
		console.error(
			'     Start it with: cd apps/server && PORT=3000 HOST=0.0.0.0 npx tsx src/index.ts',
		);
		process.exit(1);
	}
	console.log('  ✅ Server is healthy');

	// ── Step 2: Collect baseline metrics ─────────────────────────────────────
	console.log('\n[2/4] Collecting baseline metrics...');
	const baselineMetrics = [
		'positron_server_uptime_seconds',
		'positron_runs_active',
		'positron_run_failures_total',
		'positron_opencode_command_total',
		'positron_queue_jobs_waiting',
		'positron_queue_jobs_active',
		'positron_queue_worker_up',
		'positron_queue_redis_up',
	];
	const before = await collectMetrics(baselineMetrics);
	console.log('  Metric                │ Value');
	console.log('  ───────────────────────┼───────');
	for (const [name, val] of Object.entries(before)) {
		console.log(`  ${name.padEnd(23)} │ ${formatValue(val)}`);
	}

	// ── Step 3: Generate test runs ──────────────────────────────────────────
	console.log(`\n[3/4] Generating ${RUN_COUNT} test runs...`);
	let created = 0;
	let errors = 0;

	for (let i = 1; i <= RUN_COUNT; i++) {
		try {
			const issueNum = 100 + i;
			const res = await httpRequest('POST', '/api/runs', {
				issueUrl: `https://github.com/Mueller-Systems-Lab/Positron/issues/${issueNum}`,
			});
			if (res.status === 200 || res.status === 201) {
				created++;
				process.stdout.write(
					`  ✅ Run ${i}/${RUN_COUNT} created (${res.body?.run?.id?.slice(0, 8) ?? '?'}...)  \r`,
				);
			} else {
				errors++;
				process.stdout.write(`  ⚠️ Run ${i}/${RUN_COUNT} failed (HTTP ${res.status})     \r`);
			}
		} catch (err) {
			errors++;
			process.stdout.write(`  ❌ Run ${i}/${RUN_COUNT} error: ${err.message.slice(0, 40)}  \r`);
		}
		// Small delay to let pipeline progress
		await new Promise((r) => setTimeout(r, DELAY_MS));
	}
	console.log(`\n  Summary: ${created} created, ${errors} errors`);

	// ── Step 4: Collect post-drill metrics ───────────────────────────────────
	await new Promise((r) => setTimeout(r, 2000));
	console.log('\n[4/4] Collecting post-drill metrics...');
	const after = await collectMetrics(baselineMetrics);

	console.log('  Metric                │ Before  │ After   │ Delta');
	console.log('  ───────────────────────┼─────────┼─────────┼──────');
	for (const name of baselineMetrics) {
		const b = before[name];
		const a = after[name];
		const delta = b !== null && a !== null ? (a - b).toFixed(2) : '—';
		console.log(
			`  ${name.padEnd(23)} │ ${formatValue(b).padEnd(7)} │ ${formatValue(a).padEnd(7)} │ ${delta}`,
		);
	}

	console.log('\n' + '='.repeat(60));
	console.log(' Drill completed successfully');
	console.log(` Runs created: ${created}`);
	console.log(` Server: ${SERVER_URL}`);
	console.log('='.repeat(60));
}

main().catch((err) => {
	console.error('Drill failed:', err.message);
	process.exit(1);
});
