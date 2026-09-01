import { expect, test } from '@playwright/test';

const FRONTEND_URL = `http://localhost:${process.env.POSITRON_TEST_WEB_PORT || '45100'}`;

test('operator can inspect readiness and a safe next action', async ({ page }) => {
	const consoleErrors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	await page.goto(`${FRONTEND_URL}/readiness`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Operator Readiness' })).toBeVisible();
	await expect(page.getByTestId('readiness-overall')).toBeVisible();
	await expect(page.getByTestId('readiness-security_policy')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Refresh checks' })).toBeVisible();
	expect(consoleErrors).toEqual([]);
});
