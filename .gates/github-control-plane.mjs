import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const output = process.argv[2];
if (!output) throw new Error('readback output path is required');
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const local = {
	head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
	branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
	origin: execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(),
};
const targets = {
	repository: 'https://github.com/Mueller-Systems-Lab/Positron',
	issue_491: 'https://github.com/Mueller-Systems-Lab/Positron/issues/491',
	issue_493: 'https://github.com/Mueller-Systems-Lab/Positron/issues/493',
	pull_492: 'https://github.com/Mueller-Systems-Lab/Positron/pull/492',
	branch_commits: `https://github.com/Mueller-Systems-Lab/Positron/commits/${local.branch}`,
	pull_requests: 'https://github.com/Mueller-Systems-Lab/Positron/pulls',
	releases: 'https://github.com/Mueller-Systems-Lab/Positron/releases',
};
const pages = {};
try {
	for (const [key, url] of Object.entries(targets)) {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
		const body = await page.locator('body').innerText();
		pages[key] = {
			url: page.url(),
			title: await page.title(),
			readable: body.length > 0 && !body.includes('Page not found'),
			excerpt: body.slice(0, 5000),
		};
	}
	if (!Object.values(pages).every((value) => value.readable))
		throw new Error('a GitHub page was not readable');
	if (!pages.issue_491.excerpt.includes('#491') || !pages.issue_493.excerpt.includes('#493'))
		throw new Error('required issue readback missing');
	await page.goto(targets.branch_commits, { waitUntil: 'domcontentloaded', timeout: 30000 });
	const branchBody = await page.locator('body').innerText();
	if (!branchBody.includes(local.head.slice(0, 7)))
		throw new Error(`GitHub branch does not expose local HEAD ${local.head.slice(0, 7)}`);
	const readback = {
		transport: 'visible-playwright',
		mode: 'headed',
		status: 'PASS',
		repository: 'Mueller-Systems-Lab/Positron',
		captured_at: new Date().toISOString(),
		local,
		issue_491: { status: pages.issue_491.excerpt.includes('Closed') ? 'CLOSED' : 'OBSERVED' },
		issue_493: { status: pages.issue_493.excerpt.includes('Open') ? 'OPEN' : 'OBSERVED' },
		pull_492: {
			status: pages.pull_492.excerpt.includes('Merged') ? 'MERGED' : 'OBSERVED',
			reviews_visible: /review/i.test(pages.pull_492.excerpt),
			checks_visible: /checks|status/i.test(pages.pull_492.excerpt),
		},
		pages,
	};
	fs.writeFileSync(output, `${JSON.stringify(readback, null, 2)}\n`, { mode: 0o600 });
	process.stdout.write('GITHUB_CONTROL_PLANE_READBACK=PASS\n');
} finally {
	await browser.close();
}
