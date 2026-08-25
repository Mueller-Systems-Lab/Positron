import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
	getRouteManifestDrift,
	getRouteSmokeTarget,
	hasMeaningfulPageContent,
	isUnexpectedConsoleError,
	ROUTE_SMOKE_MANIFEST,
	resolveSmokeURL,
	sanitizeScreenshotName,
} from './support/route-smoke';

interface RunListResponse {
	runs?: Array<{ id?: unknown }>;
}

interface DemoRunResponse {
	run?: { id?: unknown };
}

interface RouteResult {
	routePattern: string;
	smokeURL: string;
	status: 'passed' | 'failed' | 'skipped';
	screenshot?: string;
	pageErrors: string[];
	consoleErrors: string[];
	skipReason?: string;
}

const target = getRouteSmokeTarget(process.env.POSITRON_ROUTE_SMOKE_BASE_URL);
const results: RouteResult[] = [];
const skippedRoutes = new Map<string, string>();
let runId: string | null = null;

const routeSmokeArtifactDirectory = path.resolve('test-results/route-smoke');
const routeSmokeManifestPath = path.join(routeSmokeArtifactDirectory, 'manifest.json');

function appSource(): string {
	return fs.readFileSync(path.resolve('apps/web/src/App.tsx'), 'utf8');
}

async function findFirstRun(request: {
	get: (url: string) => Promise<import('@playwright/test').APIResponse>;
}): Promise<string | null> {
	const response = await request.get('/api/runs?limit=1');
	if (!response.ok()) return null;
	const body = (await response.json()) as RunListResponse;
	const id = body.runs?.[0]?.id;
	return typeof id === 'string' && id.length > 0 ? id : null;
}

async function createLocalDemoFixture(request: {
	get: (url: string) => Promise<import('@playwright/test').APIResponse>;
	post: (
		url: string,
		options: { headers: Record<string, string>; data: object },
	) => Promise<import('@playwright/test').APIResponse>;
}): Promise<string | null> {
	if (target.mode !== 'local') return null;
	const adminToken = process.env.POSITRON_ADMIN_TOKEN;
	if (!adminToken) return null;

	const response = await request.post('/api/demo-runs', {
		headers: { 'X-Admin-Token': adminToken },
		data: { blueprint: 'Issue #250 local route smoke fixture', issueNumber: 250 },
	});
	if (!response.ok()) return null;
	const body = (await response.json()) as DemoRunResponse;
	const id = body.run?.id;
	return typeof id === 'string' && id.length > 0 ? id : null;
}

function recordSkippedFixtureRoutes(reason: string): void {
	for (const entry of ROUTE_SMOKE_MANIFEST) {
		if (entry.requiresFixture) skippedRoutes.set(entry.routePattern, reason);
	}
}

test.describe('Portable Browser Evidence Route Smoke', () => {
	test.beforeAll(async ({ request }) => {
		const drift = getRouteManifestDrift(appSource());
		expect(drift, 'Route smoke manifest drift detected').toEqual([]);

		runId = await findFirstRun(request);
		if (!runId && target.mode === 'local') {
			runId = await createLocalDemoFixture(request);
		}
		if (!runId) {
			recordSkippedFixtureRoutes(
				target.mode === 'external'
					? 'No existing run was returned by the external target; remote smoke never writes fixtures.'
					: 'Local admin fixture setup was unavailable and no existing run was present.',
			);
		}
	});

	for (const entry of ROUTE_SMOKE_MANIFEST) {
		test(`smokes ${entry.routePattern}`, async ({ page }) => {
			const skipReason = skippedRoutes.get(entry.routePattern);
			if (skipReason) {
				results.push({
					routePattern: entry.routePattern,
					smokeURL: entry.smokeURL,
					status: 'skipped',
					pageErrors: [],
					consoleErrors: [],
					skipReason,
				});
				test.skip(true, skipReason);
			}

			const smokeURL = resolveSmokeURL(entry, runId);
			const pageErrors: string[] = [];
			const consoleErrors: string[] = [];
			page.on('pageerror', (error) => pageErrors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error' && isUnexpectedConsoleError(message.text())) {
					consoleErrors.push(message.text());
				}
			});

			const response = await page.goto(smokeURL, {
				waitUntil: 'domcontentloaded',
				timeout: 30_000,
			});
			expect(response, `No document response for ${entry.routePattern}`).not.toBeNull();
			expect(response?.status(), `Document response for ${entry.routePattern}`).toBe(200);
			expect(response?.request().resourceType()).toBe('document');

			const bodyText = await page.locator('body').innerText();
			const rootText = await page.locator('#root').innerText();
			expect(hasMeaningfulPageContent(bodyText, rootText)).toBe(true);
			expect(bodyText).not.toContain('Seite nicht gefunden');
			const signal = entry.expectedPageSignal.selector
				? page.locator(entry.expectedPageSignal.selector).filter({
						hasText: entry.expectedPageSignal.name,
					})
				: page.getByRole(entry.expectedPageSignal.role, {
						name: entry.expectedPageSignal.name,
					});
			await expect(signal).toBeVisible({ timeout: 15_000 });
			expect(pageErrors, `Unexpected page errors on ${entry.routePattern}`).toEqual([]);
			expect(consoleErrors, `Unexpected console errors on ${entry.routePattern}`).toEqual([]);

			const screenshotName = sanitizeScreenshotName(entry.screenshotName);
			const screenshotPath = path.join(routeSmokeArtifactDirectory, screenshotName);
			fs.mkdirSync(routeSmokeArtifactDirectory, { recursive: true });
			await page.screenshot({ path: screenshotPath, fullPage: true });
			results.push({
				routePattern: entry.routePattern,
				smokeURL,
				status: 'passed',
				screenshot: path.relative(process.cwd(), screenshotPath),
				pageErrors,
				consoleErrors,
			});
		});
	}

	test.afterAll(() => {
		fs.mkdirSync(routeSmokeArtifactDirectory, { recursive: true });
		const report = {
			targetSource: target.source,
			targetURLRedacted: target.redactedURL,
			targetMode: target.mode,
			routesDiscovered: ROUTE_SMOKE_MANIFEST.length,
			routesTested: results
				.filter((result) => result.status !== 'skipped')
				.map((result) => result.routePattern),
			routesSkipped: results
				.filter((result) => result.status === 'skipped')
				.map((result) => ({ routePattern: result.routePattern, reason: result.skipReason })),
			screenshots: results.flatMap((result) => (result.screenshot ? [result.screenshot] : [])),
			pageErrors: results.flatMap((result) => result.pageErrors),
			consoleErrors: results.flatMap((result) => result.consoleErrors),
			unexpectedPageErrors: results.flatMap((result) => result.pageErrors),
			unexpectedAppConsoleErrors: results.flatMap((result) => result.consoleErrors),
		};
		fs.writeFileSync(routeSmokeManifestPath, `${JSON.stringify(report, null, 2)}\n`);
	});
});
