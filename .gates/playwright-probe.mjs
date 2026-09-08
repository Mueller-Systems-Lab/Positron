import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false });
try {
	const page = await browser.newPage();
	await page.goto('https://github.com/Mueller-Systems-Lab/Positron', {
		waitUntil: 'domcontentloaded',
		timeout: 30000,
	});
	const body = await page.locator('body').innerText({ timeout: 10000 });
	if (!page.url().startsWith('https://github.com/Mueller-Systems-Lab/Positron'))
		process.exitCode = 1;
	if (!body.toLowerCase().includes('positron')) process.exitCode = 1;
	console.log(`PLAYWRIGHT_HEADED=PASS\nPLAYWRIGHT_PAGE=${page.url()}\nPLAYWRIGHT_DOM=PASS`);
} finally {
	await browser.close();
}
