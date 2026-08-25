/**
 * Observe fixture for E2E tests with visible browser support.
 * Provides page.pause() for manual inspection and waitForTimeout fallback.
 */
import { test as base, expect, type Page } from '@playwright/test';

const OBSERVE = process.env.PW_OBSERVE === '1';
const OBSERVE_TIMEOUT = Number.parseInt(process.env.PW_OBSERVE_TIMEOUT ?? '30000', 10);

async function observe(page: Page): Promise<void> {
	if (!OBSERVE) return;
	console.log('\n  👁️  Observe mode: Pausing for manual inspection...');
	console.log(`  ⏱️  Timeout: ${OBSERVE_TIMEOUT / 1000}s (set PW_OBSERVE_TIMEOUT to change)`);
	console.log('  💡 Interact with the browser, then resume in Playwright Inspector.\n');
	try {
		await page.pause();
	} catch {
		// Fallback: wait for timeout if page.pause() is unavailable
		console.log('  ⚠️  page.pause() unavailable — using waitForTimeout instead.');
		await page.waitForTimeout(OBSERVE_TIMEOUT);
	}
}

export const test = base.extend({
	page: async ({ page }, use) => {
		// Navigate to app base URL
		// Use 'load' instead of 'networkidle' because SSE streams keep connections open
		await page.goto('/', { waitUntil: 'load' });
		await use(page);
	},
});

export { expect } from '@playwright/test';
export { observe };
