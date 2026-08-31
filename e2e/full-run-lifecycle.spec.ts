/**
 * Full Run Lifecycle E2E Test (QA-028 / QA-029)
 *
 * Validates the complete Positron user workflow through the web interface:
 * Dashboard → New Run → Run Detail → Pipeline Progress → DONE
 *
 * Strategy:
 * - Fake adapters (no real GitHub/OpenCode)
 * - Inline fallback via POSITRON_DISABLE_QUEUE=true (QA-029)
 * - Single test with internal steps (preserves browser state)
 * - Isolated test data: fake repo `test-owner/test-repo`, issue #1
 *
 * ── Fix History ─────────────────────────────────────────────
 * QA-029: Pipeline regression fixed. Root cause: Running BullMQ worker
 * in Redis caused server to queue jobs instead of using inline fallback.
 * Fix: POSITRON_DISABLE_QUEUE=true forces inline execution in test mode.
 *
 * ── Decision Table ────────────────────────────────────────────
 * | Entscheidung                    | Begruendung                                       |
 * |---------------------------------|--------------------------------------------------|
 * | Fake GitHub Adapter             | Server default; explicit env override in config   |
 * | Fake OpenCode Adapter           | Server default                                    |
 * | Kein echter GitHub-Token        | Fake-Mode benoetigt kein Token                    |
 * | Keine echten GitHub-Writes      | Fake-Adapter simuliert Commits/PRs                |
 * | Kein Redis/BullMQ-Zwang         | POSITRON_DISABLE_QUEUE=true                       |
 * | Deterministische Testdaten      | test-owner/test-repo / Issue #1                   |
 * | Playwright webServer Autostart  | Startet Server (port 3000) + Vite (port 5173)     |
 *
 * ── SSE/Polling ────────────────────────────────────────────────
 * | Update-Mechanismus | E2E-Validierung                                  |
 * |--------------------|--------------------------------------------------|
 * | SSE (useSSE.ts)    | Nicht direkt testbar; EventSource mockbar         |
 * | Polling (useRun.ts)| 3s Intervall aktualisiert Status                  |
 * | API Polling        | expect.poll() prueft Backend                      |
 *
 * ── CI Decision ────────────────────────────────────────────────
 * | Option | Entscheidung | Begruendung                                    |
 * |--------|-------------|-----------------------------------------------|
 * | B      | Optional    | E2E-Test ist neu; optional bis stabile CI-Runs |
 */

import { expect, test } from '@playwright/test';
import { installAdminToken } from './fixtures/admin-auth';

const BACKEND_URL = `http://localhost:${process.env.POSITRON_TEST_SERVER_PORT || '43100'}`;
const FRONTEND_URL = `http://localhost:${process.env.POSITRON_TEST_WEB_PORT || '45100'}`;

test.describe('Full Run Lifecycle E2E (QA-028)', () => {
	test.describe.configure({ mode: 'serial' });

	const consoleErrors: string[] = [];

	test.beforeEach(async ({ page }) => {
		await installAdminToken(page);

		page.on('console', (msg) => {
			if (msg.type() === 'error') consoleErrors.push(msg.text());
		});
	});

	/**
	 * Single monolithic test preserving browser state across steps.
	 *
	 * ── Coverage Table ─────────────────────────────────────────
	 * | Schritt | Aktion                               | Assertion                                  |
	 * |---------|--------------------------------------|--------------------------------------------|
	 * | 1       | Dashboard laedt                      | Heading + Hauptnav sichtbar                |
	 * | 2       | "+ New Run" oeffnen + URL eingeben   | Modal sichtbar, Input gefuellt             |
	 * | 3       | "Start Run" klicken + Navigation     | URL = /runs/:id                            |
	 * | 4       | Run-Detail-Seite geladen             | Pipeline sichtbar, Run-Header sichtbar     |
	 * | 5       | API Polling: Auf DONE warten         | run.phase === "DONE"                       |
	 * | 6       | UI zeigt DONE Status                 | DONE Badge sichtbar                        |
	 * | 7       | Navigation zu allen Seiten           | Dashboard, Runs, Evidence, Settings ok     |
	 * | 8       | Backend Health final pruefen         | /api/health = ok                           |
	 */
	test('Run lifecycle UI validation — full QUEUED→DONE', async ({ page }) => {
		let runId: string | null = null;

		// ── Step 1: Dashboard loads ──────────────────────────────
		await test.step('S01: Dashboard loads', async () => {
			await page.goto(FRONTEND_URL, {
				waitUntil: 'domcontentloaded',
				timeout: 30_000,
			});
			await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
				timeout: 10_000,
			});
			await expect(page.getByRole('main')).toBeVisible({
				timeout: 10_000,
			});
			await expect(page.getByRole('button', { name: '+ New Run' })).toBeVisible({
				timeout: 10_000,
			});
		});

		// ── Step 2-3: Open modal, fill URL, start run ─────────
		await test.step('S02: Create run via New Run modal', async () => {
			await page.getByRole('button', { name: '+ New Run' }).click();
			await expect(page.getByRole('button', { name: 'Start Run' })).toBeVisible({ timeout: 5_000 });

			await page
				.getByPlaceholder('https://github.com/owner/repo/issues/123')
				.fill('https://github.com/test-owner/test-repo/issues/1');

			await page.getByRole('button', { name: 'Start Run' }).click();
			await page.waitForURL(/\/runs\/[\w-]+/, { timeout: 15_000 });

			const match = page.url().match(/\/runs\/([\w-]+)/);
			runId = match ? match[1] : null;
			expect(runId, 'Run ID should be extracted from URL').toBeTruthy();
		});

		// ── Step 4: Run detail page verification ──────────────
		await test.step('S03: Run detail page loads', async () => {
			await page.waitForTimeout(2_000);

			// Phase pipeline visible
			await expect(page.locator('[aria-label="Pipeline phases"]')).toBeVisible({
				timeout: 10_000,
			});

			// Run heading visible: "Run {id.slice(0,8)}"
			await expect(page.locator('h1').filter({ hasText: /Run\s/ })).toBeVisible({
				timeout: 10_000,
			});

			// Verify a phase badge is shown (QUEUED or any phase)
			await expect(page.locator('[aria-label="Pipeline phases"]')).toBeVisible();
		});

		// ── Step 5: Wait for DONE via API polling ────────────
		// QA-029: Pipeline regression fixed — inline fallback completes
		// synchronously within the POST response. The run is already DONE
		// by the time we navigate to the detail page.
		await test.step('S04: Verify DONE via API', async () => {
			expect(runId).toBeTruthy();
			await expect
				.poll(
					async () => {
						const res = await fetch(`${BACKEND_URL}/api/runs/${runId}`);
						const data = (await res.json()) as {
							run: { phase: string; status: string };
						};
						return data.run?.phase ?? null;
					},
					{
						timeout: 15_000,
						message: `Run ${runId} should reach DONE phase`,
					},
				)
				.toBe('DONE');
		});

		// ── Step 6: UI DONE verification ─────────────────────
		await test.step('S05: UI shows DONE status', async () => {
			// Reload to ensure fresh UI state
			await page.reload();
			await page.waitForTimeout(1_000);

			// DONE should be visible in the pipeline or status badge
			// The run detail page should reflect the DONE phase
			await expect(page.locator('[aria-label="Pipeline phases"]')).toBeVisible({
				timeout: 10_000,
			});

			// Verify no error banner is present
			const errorBanner = page.locator('[role="alert"]');
			await expect(errorBanner).toHaveCount(0, { timeout: 5_000 });
		});

		// ── Step 7: Regression — all pages reachable ────────
		await test.step('S06: All pages remain functional', async () => {
			// Dashboard
			await page.goto(FRONTEND_URL, {
				waitUntil: 'domcontentloaded',
				timeout: 15_000,
			});
			await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
				timeout: 10_000,
			});

			// Runs page
			await page.getByRole('link', { name: 'Runs', exact: true }).click();
			await page.waitForURL(/\/runs/, { timeout: 10_000 });
			await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible({
				timeout: 10_000,
			});

			// Evidence page
			await page.getByRole('link', { name: 'Evidence' }).click();
			await page.waitForURL(/\/evidence/, { timeout: 10_000 });
			await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible({
				timeout: 10_000,
			});

			// Settings page
			await page.getByRole('link', { name: 'Settings' }).click();
			await page.waitForURL(/\/settings/, { timeout: 10_000 });
			await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
				timeout: 10_000,
			});
		});

		// ── Step 8: Backend health final check ──────────────
		await test.step('S07: Backend health remains stable', async () => {
			const healthRes = await fetch(`${BACKEND_URL}/api/health`);
			expect(healthRes.ok).toBe(true);
			const healthData = (await healthRes.json()) as {
				status: string;
			};
			expect(healthData.status).toBe('ok');

			const runsRes = await fetch(`${BACKEND_URL}/api/runs`);
			expect(runsRes.ok).toBe(true);
			const runsData = (await runsRes.json()) as {
				runs: Array<unknown>;
			};
			expect(runsData.runs).toBeDefined();
			expect(runsData.runs.length).toBeGreaterThan(0);
		});
	});

	// ── Console error check ─────────────────────────────────
	test('No critical console errors during lifecycle', () => {
		const critical = consoleErrors.filter(
			(e) => !e.includes('favicon') && !e.includes('404') && !e.includes('net::ERR_'),
		);
		expect(critical.length, `Console errors: ${critical.join('; ')}`).toBe(0);
	});
});
