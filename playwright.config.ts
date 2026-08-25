import { defineConfig, devices } from '@playwright/test';
import { getRouteSmokeTarget } from './e2e/support/route-smoke';

/**
 * Positron Playwright E2E Configuration (QA-028, L4)
 *
 * Strategy:
 * - Fake adapters only — no real GitHub/OpenCode calls
 * - Explicit VITEST=true skips .env loading (prevents real mode activation)
 * - Chromium only (consistent across CI and local)
 * - webServer auto-starts backend (port 3000) and frontend (port 5173)
 * - reuseExistingServer: true — works with manually started servers
 * - Single worker — sequential execution avoids port conflicts
 *
 * Evidence (L4 — Browser Verification):
 * - Screenshots: captured programmatically via e2e/support/artifacts.js
 * - Video: recorded on failure (CI only, to save storage)
 * - Trace: recorded on every test for full replay capability
 * - Console/Network: redacted logs via e2e/support/console-network.js
 *
 * Output directories (gitignored):
 * - test-results/      — screenshots, evidence logs, per-test traces
 * - playwright-report/ — HTML report
 */

const FAKE_MODE_ENV = {
	// Skip .env loading entirely — the .env file sets real mode
	VITEST: 'true',
	// Explicit fake mode for ALL adapters
	POSITRON_GITHUB_MODE: 'fake',
	POSITRON_OPENCODE_MODE: 'fake',
	POSITRON_SPECKIT_MODE: 'fake',
	// QA-029: Force inline pipeline execution (no BullMQ dependency)
	POSITRON_DISABLE_QUEUE: 'true',
	// Required repository config (needed when .env is skipped)
	POSITRON_REPO_OWNER: 'test-owner',
	POSITRON_REPO_NAME: 'test-repo',
	POSITRON_REPO_DEFAULT_BRANCH: 'main',
	// Prevent real token usage
	GITHUB_TOKEN: '',
	// QA-069: Admin token for E2E write operations (demo runs, etc.)
	// Must match the token injected into browser localStorage by test setup
	POSITRON_ADMIN_TOKEN: 'positron-test-token-dev',
};

const routeSmokeTarget = getRouteSmokeTarget(process.env.POSITRON_ROUTE_SMOKE_BASE_URL);

// QA-069: Propagate admin token to test worker processes.
// Test workers inherit parent process.env, so setting it here ensures
// server (via webServer.env → FAKE_MODE_ENV) and test workers use the
// same value. No fallbacks needed in spec files.
process.env.POSITRON_ADMIN_TOKEN =
	process.env.POSITRON_ADMIN_TOKEN || FAKE_MODE_ENV.POSITRON_ADMIN_TOKEN;

export default defineConfig({
	testDir: './e2e',
	testIgnore: ['**/support/route-smoke.test.ts'],
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: 'html',
	use: {
		baseURL: routeSmokeTarget.baseURL,
		// L4: Trace on every test for full failure replay
		trace: 'retain-on-failure',
		// L4: Record video on failure in CI (saves storage in local dev)
		video: process.env.CI ? 'retain-on-failure' : 'off',
		// L4: Screenshot on failure (automatic fallback)
		screenshot: 'only-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer:
		routeSmokeTarget.mode === 'local'
			? [
					{
						command: 'npx tsx src/index.ts',
						cwd: './apps/server',
						url: 'http://localhost:3000/api/health',
						reuseExistingServer: true,
						timeout: 30000,
						env: {
							...process.env,
							...FAKE_MODE_ENV,
						},
					},
					{
						command: 'npx vite --port 5173',
						cwd: './apps/web',
						url: 'http://localhost:5173',
						reuseExistingServer: true,
						timeout: 30000,
					},
				]
			: undefined,
});
