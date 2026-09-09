import { expect, test } from '@playwright/test';

test.describe('Post-Green adversarial product checks', () => {
	test('dashboard remains usable at a narrow mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
		await expect(page.getByRole('button', { name: /new run/i })).toBeVisible();
		const widths = await page.evaluate(() => ({
			viewport: window.innerWidth,
			document: document.documentElement.scrollWidth,
		}));
		expect(widths.document).toBeLessThanOrEqual(widths.viewport);
	});

	test('navigation survives a full page reload', async ({ page }) => {
		await page.goto('/settings', { waitUntil: 'domcontentloaded' });
		await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	});

	test('an invalid run URL renders a controlled product state', async ({ page }) => {
		const response = await page.goto('/runs/does-not-exist', { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBe(200);
		await expect(page.locator('#root')).not.toBeEmpty();
		const body = await page.locator('body').innerText();
		expect(body).toMatch(/Run not found|No Run ID provided|Not found/i);
		expect(body).not.toContain('Unhandled Runtime Error');
		expect(body).not.toContain('Page not found');
	});
});
