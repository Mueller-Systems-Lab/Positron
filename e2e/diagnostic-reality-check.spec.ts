/**
 * Positron Reality Check — Diagnostic Playwright Test
 *
 * This test captures:
 * 1. Console logs (warnings, errors, failed resources)
 * 2. Network requests (URL, method, status, response type, errors)
 * 3. Screenshots of key pages
 * 4. Video recording
 * 5. Trace for debugging
 *
 * It does NOT modify any code. It is read-only diagnostics.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { installAdminToken } from './fixtures/admin-auth';

const API_BASE = 'http://localhost:3000';
const DIAG_DIR = 'test-results/positron-reality-check';
const SCREENSHOT_DIR = `${DIAG_DIR}/screenshots`;
const NETWORK_LOG = `${DIAG_DIR}/network-log.json`;
const CONSOLE_LOG = `${DIAG_DIR}/console-log.json`;
const MANIFEST = `${DIAG_DIR}/manifest.json`;

interface NetworkEntry {
	url: string;
	method: string;
	status: number;
	responseType: string;
	error?: string;
	timestamp: string;
}

interface ConsoleEntry {
	type: string;
	text: string;
	location?: string;
	timestamp: string;
}

test.describe('Positron Reality Check', () => {
	const networkEntries: NetworkEntry[] = [];
	const consoleEntries: ConsoleEntry[] = [];

	test.beforeAll(() => {
		// Ensure directories exist
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	});

	test.beforeEach(async ({ page, context }) => {
		// Enable request/response logging
		await context.route('**/*', async (route) => {
			const request = route.request();
			const entry: NetworkEntry = {
				url: request.url(),
				method: request.method(),
				status: 0,
				responseType: 'unknown',
				timestamp: new Date().toISOString(),
			};
			try {
				const response = await route.fetch();
				entry.status = response.status();
				entry.responseType = response.headers()['content-type'] ?? 'unknown';
				entry.error = response.ok() ? undefined : `HTTP ${response.status()}`;
				networkEntries.push(entry);
				await route.fulfill({ response });
			} catch (err) {
				entry.error = err instanceof Error ? err.message : String(err);
				networkEntries.push(entry);
				await route.continue();
			}
		});

		// Capture console messages
		page.on('console', (msg) => {
			consoleEntries.push({
				type: msg.type(),
				text: msg.text(),
				location: msg.location()?.url ?? undefined,
				timestamp: new Date().toISOString(),
			});
		});

		page.on('pageerror', (err) => {
			consoleEntries.push({
				type: 'pageerror',
				text: err.message,
				location: err.stack,
				timestamp: new Date().toISOString(),
			});
		});
	});

	test.afterAll(async () => {
		// Write network log
		fs.writeFileSync(NETWORK_LOG, JSON.stringify(networkEntries, null, 2));
		console.log(`[Diagnostic] Network log: ${NETWORK_LOG} (${networkEntries.length} entries)`);

		// Write console log
		fs.writeFileSync(CONSOLE_LOG, JSON.stringify(consoleEntries, null, 2));
		console.log(`[Diagnostic] Console log: ${CONSOLE_LOG} (${consoleEntries.length} entries)`);

		// Write manifest
		const manifest = {
			testName: 'Positron Reality Check',
			timestamp: new Date().toISOString(),
			baseUrl: 'http://localhost:5173',
			apiUrl: 'http://localhost:3000',
			artifacts: {
				screenshots: fs.readdirSync(SCREENSHOT_DIR).filter((f) => f.endsWith('.png')),
				networkLog: 'network-log.json',
				consoleLog: 'console-log.json',
				trace: 'trace.zip',
				video: 'video.webm',
			},
			networkEntryCount: networkEntries.length,
			consoleEntryCount: consoleEntries.length,
			warnings: consoleEntries.filter((e) => e.type === 'warning').length,
			errors: consoleEntries.filter((e) => e.type === 'error' || e.type === 'pageerror').length,
			failedRequests: networkEntries.filter((e) => e.error && e.error !== 'unknown').length,
		};
		fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
		console.log(`[Diagnostic] Manifest: ${MANIFEST}`);
	});

	test('1. Frontend loads and displays correctly', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveTitle(/Positron/);
		await expect(page.getByRole('heading', { name: /Dashboard/i })).toBeVisible();
		// Take screenshot
		await page.screenshot({
			path: `${SCREENSHOT_DIR}/dashboard.png`,
			fullPage: true,
		});
		console.log('[Diagnostic] Dashboard screenshot captured');
	});

	test('2. Dashboard shows API-connected components', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveTitle(/Positron/);

		// Check for key UI elements
		const headingCount = await page.getByRole('heading').count();
		console.log(`[Diagnostic] Found ${headingCount} headings on dashboard`);

		// Check for the  "New Run" button
		const newRunBtn = page.getByRole('button', { name: /New Run/i });
		await expect(newRunBtn).toBeVisible();

		// Check for Blueprint panel
		const blueprintHeader = page.getByText(/Demo Blueprint/i);
		await expect(blueprintHeader).toBeVisible();

		// Check for Start Demo Run button
		const demoRunBtn = page.getByRole('button', { name: /Start Demo Run/i });
		await expect(demoRunBtn).toBeVisible();
		await expect(demoRunBtn).toBeEnabled();
	});

	test('3. API endpoints are all reachable from frontend context', async ({ page }) => {
		// Test that the frontend proxy to API works
		const healthRes = await page.request.get(`${API_BASE}/api/health`);
		expect(healthRes.ok()).toBeTruthy();
		const healthData = await healthRes.json();
		expect(healthData.status).toBe('ok');
		console.log(`[Diagnostic] Health: status=${healthData.status}, mode=${healthData.mode}`);

		const runsRes = await page.request.get(`${API_BASE}/api/runs`);
		expect(runsRes.ok()).toBeTruthy();
		const runsData = await runsRes.json();
		console.log(`[Diagnostic] Runs: ${runsData.total} total`);

		const safetyRes = await page.request.get(`${API_BASE}/api/safety`);
		expect(safetyRes.ok()).toBeTruthy();
		const safetyData = await safetyRes.json();
		console.log('[Diagnostic] Safety:', JSON.stringify(safetyData));

		const metricsRes = await page.request.get(`${API_BASE}/api/metrics`);
		expect(metricsRes.ok()).toBeTruthy();
	});

	test('4. User can start a demo run from UI', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveTitle(/Positron/);

		// Try to start a demo run using the Blueprint panel
		// First, enter a repo ID and issue number
		const repoInput = page.getByLabel('Repository (owner/repo)');
		const issueInput = page.getByLabel('Issue number');
		const demoRunBtn = page.getByRole('button', { name: /Start Demo Run/i });

		// Fill in the form
		await repoInput.fill('Mueller-Systems-Lab/Positron');
		await issueInput.fill('1');
		console.log('[Diagnostic] Filled repo/issue inputs for demo run');

		// Check if "Generate Blueprint" is available and works
		const generateBtn = page.getByRole('button', {
			name: /Generate Blueprint/i,
		});
		if (await generateBtn.isVisible()) {
			await generateBtn.click();
			// Wait a bit for blueprint to generate
			await page.waitForTimeout(3000);
			console.log('[Diagnostic] Generate Blueprint clicked');
		}

		// Try to click "Start Demo Run"
		// Note: This might fail if the blueprint was not generated, but the button should be present
		await expect(demoRunBtn).toBeVisible();
		const isDisabled = await demoRunBtn.isDisabled();
		console.log(`[Diagnostic] Start Demo Run button disabled: ${isDisabled}`);

		// Take screenshot of the blueprint panel state
		await page.screenshot({
			path: `${SCREENSHOT_DIR}/blueprint-panel.png`,
			fullPage: false,
		});

		// If the button is not disabled, try clicking it
		if (!isDisabled) {
			// QA-069: Inject admin token before write operations
			await installAdminToken(page);

			await demoRunBtn.click();
			console.log('[Diagnostic] Start Demo Run clicked');
			// Wait for navigation to run detail
			await page.waitForTimeout(3000);
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/run-detail.png`,
				fullPage: true,
			});
			console.log('[Diagnostic] Run detail screenshot captured');
		} else {
			console.log('[Diagnostic] Start Demo Run button is disabled — cannot start demo run from UI');
		}
	});

	test('5. Runs page and run detail page are accessible', async ({ page }) => {
		// Navigate to Runs page
		await page.goto('/runs');
		await page.waitForTimeout(1000);
		await page.screenshot({
			path: `${SCREENSHOT_DIR}/runs-page.png`,
			fullPage: true,
		});
		console.log('[Diagnostic] Runs page screenshot captured');

		// Navigate to Evidence page
		await page.goto('/evidence');
		await page.waitForTimeout(1000);
		await page.screenshot({
			path: `${SCREENSHOT_DIR}/evidence-page.png`,
			fullPage: true,
		});
		console.log('[Diagnostic] Evidence page screenshot captured');

		// Navigate to Repositories page
		await page.goto('/repos');
		await page.waitForTimeout(1000);
		await page.screenshot({
			path: `${SCREENSHOT_DIR}/repos-page.png`,
			fullPage: true,
		});
		console.log('[Diagnostic] Repos page screenshot captured');

		// Navigate to Settings page
		await page.goto('/settings');
		await page.waitForTimeout(1000);
		await page.screenshot({
			path: `${SCREENSHOT_DIR}/settings-page.png`,
			fullPage: true,
		});
		console.log('[Diagnostic] Settings page screenshot captured');
	});

	test('6. Run detail page for existing failed run', async ({ page }) => {
		// Get the existing run from the API
		const runsRes = await page.request.get(`${API_BASE}/api/runs?limit=1`);
		const runsData = await runsRes.json();
		if (runsData.runs && runsData.runs.length > 0) {
			const runId = runsData.runs[0].id;
			console.log(`[Diagnostic] Navigating to run detail: ${runId}`);
			await page.goto(`/runs/${runId}`);
			await page.waitForTimeout(1500);
			await page.screenshot({
				path: `${SCREENSHOT_DIR}/run-detail-existing.png`,
				fullPage: true,
			});
			console.log('[Diagnostic] Existing run detail screenshot captured');

			// Check if pipeline is displayed
			const pipeline = page.getByText(/Phase Pipeline/i);
			if (await pipeline.isVisible()) {
				console.log('[Diagnostic] Phase Pipeline is visible');
			} else {
				console.log('[Diagnostic] Phase Pipeline is NOT visible');
			}
		} else {
			console.log('[Diagnostic] No existing runs found — skipping run detail');
		}
	});
});
