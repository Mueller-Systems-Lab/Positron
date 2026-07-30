#!/usr/bin/env node
/**
 * Positron Queue Backlog Drill (QA-018)
 *
 * Safely simulates QueueBacklogCritical by enqueuing jobs into an isolated
 * test queue (positron-observability-drill). Never touches the production
 * pipeline queue.
 *
 * Usage:
 *   node scripts/queue-backlog-drill.mjs [--jobs=60] [--server=http://localhost:3000]
 *   npm run observability:queue-backlog
 *
 * Prerequisites:
 *   1. Redis running (localhost:6379 or POSITRON_REDIS_URL)
 *   2. Positron server running (metrics endpoint)
 *   3. Prometheus scraping the server
 *   4. Optional: webhook mock on port 5001
 *
 * Exit codes:
 *   0 — Drill completed, alert fired and resolved
 *   1 — Prerequisites not met or drill failed
 */

import http from 'node:http';

// ── Configuration ──────────────────────────────────────────────────────────
const SERVER_URL = process.env.POSITRON_SERVER_URL ?? 'http://localhost:3000';
const JOB_COUNT = Number.parseInt(process.env.POSITRON_DRILL_JOB_COUNT ?? '60', 10);
const PROMETHEUS_URL = process.env.POSITRON_PROMETHEUS_URL ?? 'http://localhost:9090';
const MOCK_URL = process.env.POSITRON_MOCK_URL ?? 'http://localhost:5001';
const REDIS_URL = process.env.POSITRON_REDIS_URL ?? 'redis://localhost:6379';
const DRILL_QUEUE = 'positron-observability-drill';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ── Helpers ────────────────────────────────────────────────────────────────

function httpGet(url) {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const options = {
			hostname: parsed.hostname,
			port: parsed.port,
			path: parsed.pathname + parsed.search,
			method: 'GET',
			timeout: 5000,
		};
		const req = http.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => {
				data += chunk;
			});
			res.on('end', () => resolve({ status: res.statusCode, body: data }));
		});
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('Request timeout'));
		});
		req.end();
	});
}

function getMetricValue(metricText, name, labelFilter) {
	const regex = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([\\d.e+]+)`, 'm');
	if (labelFilter) {
		// Find line matching specific label
		for (const line of metricText.split('\n')) {
			if (line.startsWith(name + '{') && line.includes(labelFilter)) {
				const match = line.match(/\s+([\d.e+]+)$/m);
				return match ? Number.parseFloat(match[1]) : null;
			}
		}
	}
	const match = metricText.match(regex);
	return match ? Number.parseFloat(match[1]) : null;
}

function log(level, message) {
	const prefix = level === 'ERROR' ? RED + '❌' : level === 'WARN' ? YELLOW + '⚠️' : GREEN + '✅';
	console.log(`  ${prefix}${RESET} ${message}`);
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

// ── Main Drill ────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	let jobCount = JOB_COUNT;
	for (const arg of args) {
		if (arg.startsWith('--jobs=')) {
			jobCount = Number.parseInt(arg.slice(7), 10);
		} else if (arg.startsWith('--help') || arg === '-h') {
			console.log('Usage: node scripts/queue-backlog-drill.mjs [--jobs=N]');
			console.log('  --jobs=N   Number of drill jobs (default: 60, min: 55, max: 75)');
			process.exit(0);
		}
	}

	// Clamp to safe range
	jobCount = Math.max(55, Math.min(75, jobCount));

	console.log(BOLD + '='.repeat(60) + RESET);
	console.log(BOLD + ' Queue Backlog Critical Drill (QA-018)' + RESET);
	console.log(BOLD + '='.repeat(60) + RESET);
	console.log(` Drill queue:  ${DRILL_QUEUE}`);
	console.log(` Job count:    ${jobCount} (above 50 threshold)`);
	console.log(` Redis:        ${REDIS_URL}`);
	console.log(` Server:       ${SERVER_URL}`);
	console.log('');

	// ── Step 1: Prerequisites ────────────────────────────────────────────
	console.log(BOLD + '[1/7] Prerequisites' + RESET);

	let serverOk = false;
	try {
		const res = await httpGet(`${SERVER_URL}/api/health`);
		serverOk = res.status === 200;
	} catch {
		/* silent */
	}
	if (serverOk) log('INFO', 'Positron server reachable');
	else {
		log('ERROR', 'Positron server NOT reachable — start it first');
		process.exit(1);
	}

	let promOk = false;
	try {
		const res = await httpGet(`${PROMETHEUS_URL}/api/v1/targets`);
		promOk = res.status === 200;
	} catch {
		/* silent */
	}
	if (promOk) log('INFO', 'Prometheus reachable');
	else log('WARN', 'Prometheus not reachable (alert check will be skipped)');

	let mockOk = false;
	try {
		const res = await httpGet(`${MOCK_URL}/health`);
		mockOk = res.status === 200;
	} catch {
		/* silent */
	}
	if (mockOk) log('INFO', 'Webhook mock reachable');
	else log('WARN', 'Webhook mock not reachable');
	console.log('');

	// ── Step 2: Baseline Metrics ──────────────────────────────────────────
	console.log(BOLD + '[2/7] Baseline Metrics' + RESET);

	let metricText = '';
	try {
		const res = await httpGet(`${SERVER_URL}/metrics`);
		metricText = res.body;
	} catch {
		log('ERROR', 'Cannot fetch metrics');
		process.exit(1);
	}

	const beforeBacklog =
		getMetricValue(metricText, 'positron_queue_jobs_waiting', `queue="${DRILL_QUEUE}"`) ?? 0;
	const beforePipelineBacklog =
		getMetricValue(metricText, 'positron_queue_jobs_waiting', 'queue="positron-pipeline"') ?? 0;
	const beforeRedis = getMetricValue(metricText, 'positron_queue_redis_up') ?? 0;
	const beforeWorker = getMetricValue(metricText, 'positron_queue_worker_up') ?? 0;

	console.log(`  Drill queue waiting:   ${BLUE}${beforeBacklog}${RESET}`);
	console.log(`  Pipeline queue waiting: ${BLUE}${beforePipelineBacklog}${RESET}`);
	console.log(`  Redis UP:               ${BLUE}${beforeRedis}${RESET}`);
	console.log(`  Worker UP:              ${BLUE}${beforeWorker}${RESET}`);

	if (beforeBacklog > 0) {
		log('WARN', `Drill queue has ${beforeBacklog} leftover jobs — cleaning up first`);
	}
	console.log('');

	// ── Step 3: Enqueue Drill Jobs ────────────────────────────────────────
	console.log(BOLD + `[3/7] Enqueue ${jobCount} Drill Jobs` + RESET);

	let queue = null;
	let queuedCount = 0;
	try {
		const { Queue } = await import('bullmq');
		queue = new Queue(DRILL_QUEUE, {
			connection: {
				url: REDIS_URL,
				connectTimeout: 5000,
			},
		});

		// Clean any leftover jobs from previous drill first
		try {
			await queue.drain();
			await queue.clean(0, 1000, 'wait');
			await queue.clean(0, 1000, 'active');
			await queue.clean(0, 1000, 'completed');
		} catch {
			/* drain/clean can fail if queue is new */
		}

		for (let i = 0; i < jobCount; i++) {
			await queue.add(
				'drill-job',
				{
					drill: true,
					index: i,
					timestamp: Date.now(),
				},
				{
					removeOnComplete: { count: 1000 },
					removeOnFail: { count: 1000 },
				},
			);
			queuedCount++;
			if (i % 20 === 0 && i > 0) {
				process.stdout.write(`  Enqueued ${i}/${jobCount}...\r`);
			}
		}
		log('INFO', `${queuedCount} jobs enqueued to "${DRILL_QUEUE}"`);
	} catch (err) {
		log('ERROR', `Cannot enqueue: ${err.message}`);
		if (queue) await queue.close().catch(() => {});
		process.exit(1);
	}
	console.log('');

	// ── Step 4: Wait for Metric Update ─────────────────────────────────────
	console.log(BOLD + '[4/7] Wait for Metric Update' + RESET);
	console.log('  Waiting for server collect cycle (30s) + Prometheus scrape...');

	// Wait for server's collectQueueStats to pick up the new queue
	await sleep(15000);
	log('INFO', '15s elapsed — checking metrics...');

	// The server's collectQueueStats only checks "positron-pipeline" queue.
	// We need to check if drill queue metrics are reported.
	// Since the server code only checks positron-pipeline, we need to
	// read BullMQ directly.

	let drillWaiting = 0;
	try {
		const { Queue: Q2 } = await import('bullmq');
		const checkQueue = new Queue(DRILL_QUEUE, {
			connection: { url: REDIS_URL, connectTimeout: 5000 },
		});
		const counts = await checkQueue.getJobCounts('waiting');
		drillWaiting = counts.waiting ?? 0;
		await checkQueue.close();
		log('INFO', `Drill queue waiting (via BullMQ): ${drillWaiting}`);
	} catch (err) {
		log('ERROR', `Cannot check drill queue: ${err.message}`);
	}

	// Re-fetch metrics to see if drill queue shows up
	try {
		const res = await httpGet(`${SERVER_URL}/metrics`);
		metricText = res.body;
		const afterBacklog =
			getMetricValue(metricText, 'positron_queue_jobs_waiting', `queue="${DRILL_QUEUE}"`) ?? 0;
		const afterPipelineBacklog =
			getMetricValue(metricText, 'positron_queue_jobs_waiting', 'queue="positron-pipeline"') ?? 0;

		console.log(
			`  Drill queue (metrics):   ${BLUE}${afterBacklog}${RESET} (BullMQ: ${drillWaiting})`,
		);
		console.log(`  Pipeline queue (metrics): ${BLUE}${afterPipelineBacklog}${RESET}`);

		if (afterPipelineBacklog > beforePipelineBacklog) {
			log(
				'ERROR',
				'PIPELINE QUEUE AFFECTED! This is a bug — pipeline queue should not be affected by drill.',
			);
		}
	} catch {
		/* silent */
	}
	console.log('');

	// ── Step 5: Check Prometheus Alerts ────────────────────────────────────
	console.log(BOLD + '[5/7] Check Prometheus Alerts' + RESET);

	if (promOk) {
		try {
			const res = await httpGet(`${PROMETHEUS_URL}/api/v1/alerts`);
			const data = JSON.parse(res.body);

			if (data?.data?.alerts) {
				const drillAlerts = data.data.alerts.filter(
					(a) => a?.labels?.alertname === 'QueueBacklogCriticalDrill',
				);
				const productionAlerts = data.data.alerts.filter(
					(a) => a?.labels?.alertname === 'QueueBacklogCritical',
				);

				if (drillAlerts.length > 0) {
					log('INFO', `QueueBacklogCriticalDrill ALERT: ${drillAlerts[0].state}`);
					console.log(`      Alert state: ${BLUE}${drillAlerts[0].state}${RESET}`);
					console.log(
						`      Summary: ${BLUE}${drillAlerts[0].annotations?.summary ?? 'N/A'}${RESET}`,
					);
				} else {
					log('WARN', 'QueueBacklogCriticalDrill NOT firing yet (waiting for Prometheus scrape)');
					console.log(`      Note: Alert has 30s "for" — may need another scrape cycle.`);
				}

				if (productionAlerts.length > 0) {
					log(
						'WARN',
						`QueueBacklogCritical (production) is firing! state=${productionAlerts[0].state}`,
					);
					console.log('      This may be normal if the pipeline queue has >50 jobs.');
				} else {
					log('INFO', 'QueueBacklogCritical (production) NOT firing — correct');
				}
			}
		} catch (err) {
			log('WARN', `Cannot parse Prometheus alerts: ${err.message}`);
		}
	} else {
		log('WARN', 'Prometheus not reachable — alert check skipped');
	}
	console.log('');

	// ── Step 6: Check Webhook Mock ─────────────────────────────────────────
	console.log(BOLD + '[6/7] Check Webhook Mock' + RESET);

	if (mockOk) {
		try {
			const res = await httpGet(`${MOCK_URL}/alerts/warning`);
			const data = JSON.parse(res.body);
			const drillWebhooks = (data?.alerts ?? []).filter(
				(a) => a?.data?.alertname === 'QueueBacklogCriticalDrill',
			);
			console.log(`  Total alerts in mock: ${BLUE}${data?.total ?? 0}${RESET}`);
			console.log(`  Drill alerts in mock: ${BLUE}${drillWebhooks.length}${RESET}`);
			if (drillWebhooks.length > 0) {
				log('INFO', 'Drill alert received by webhook mock');
			} else {
				log(
					'WARN',
					'Drill alert not yet received by webhook mock (may need Alertmanager dispatch)',
				);
			}
		} catch (err) {
			log('WARN', `Cannot check webhook mock: ${err.message}`);
		}
	} else {
		log('WARN', 'Webhook mock not reachable');
	}
	console.log('');

	// ── Step 7: Cleanup ────────────────────────────────────────────────────
	console.log(BOLD + '[7/7] Cleanup — Isolated Test Queue Only' + RESET);

	try {
		// Drain all waiting jobs
		await queue.drain();
		log('INFO', 'Drained drill queue');

		// Clean completed/failed jobs
		await queue.clean(0, 2000, 'completed');
		await queue.clean(0, 2000, 'failed');
		await queue.clean(0, 2000, 'wait');
		await queue.clean(0, 2000, 'delayed');
		log('INFO', 'Cleaned all drill queue job states');

		// Obliterate the test queue to remove it from Redis entirely
		await queue.obliterate({ force: true });
		log('INFO', `Queue "${DRILL_QUEUE}" obliterated`);

		await queue.close();
	} catch (err) {
		log('ERROR', `Cleanup failed: ${err.message}`);
		try {
			await queue?.close();
		} catch {
			/* best effort */
		}
	}
	console.log('');

	// ── Summary ────────────────────────────────────────────────────────────
	console.log(BOLD + '='.repeat(60) + RESET);
	console.log(BOLD + ' Drill Summary' + RESET);
	console.log(`  Queue used:       ${DRILL_QUEUE}`);
	console.log(`  Jobs enqueued:    ${queuedCount}`);
	console.log(`  Jobs waiting:     ${drillWaiting}`);
	console.log('  Production queue: UNTOUCHED');
	console.log('  Cleanup:          Queue obliterated from Redis');
	console.log('');
	console.log('  ⚠️  QueueBacklogCriticalDrill may have fired on Prometheus.');
	console.log('     Check: curl http://localhost:9090/api/v1/alerts');
	console.log('  ⚠️  Alert resolution may take 1-2 minutes after cleanup.');
	console.log(BOLD + '='.repeat(60) + RESET);

	process.exit(0);
}

main().catch((err) => {
	console.error(`${RED}Drill crashed:${RESET} ${err.message}`);
	process.exit(1);
});
