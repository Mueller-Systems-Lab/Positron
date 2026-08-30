export const ROUTE_SMOKE_BASE_URL_ENV = 'POSITRON_ROUTE_SMOKE_BASE_URL' as const;
const TEST_WEB_PORT = process.env.POSITRON_TEST_WEB_PORT || '45100';

export type RouteSmokeMode = 'local' | 'external';

export interface RouteSmokeTarget {
	baseURL: string;
	mode: RouteSmokeMode;
	source: 'playwright-webServer' | typeof ROUTE_SMOKE_BASE_URL_ENV;
	redactedURL: string;
}

export interface RouteSmokeSignal {
	role: 'heading';
	name: string | RegExp;
	selector?: string;
}

export interface RouteSmokeManifestEntry {
	routePattern: string;
	smokeURL: string;
	requiresFixture: boolean;
	expectedPageSignal: RouteSmokeSignal;
	screenshotName: string;
	specialSetup: string;
}

export const ROUTE_SMOKE_MANIFEST: readonly RouteSmokeManifestEntry[] = [
	{
		routePattern: '/',
		smokeURL: '/',
		requiresFixture: false,
		expectedPageSignal: { role: 'heading', name: 'Dashboard' },
		screenshotName: 'dashboard.png',
		specialSetup: 'none',
	},
	{
		routePattern: '/runs',
		smokeURL: '/runs',
		requiresFixture: false,
		expectedPageSignal: { role: 'heading', name: 'Runs' },
		screenshotName: 'runs.png',
		specialSetup: 'none',
	},
	{
		routePattern: '/runs/:id',
		smokeURL: '/runs/{existing-run-id}',
		requiresFixture: true,
		expectedPageSignal: { role: 'heading', name: /Run\s/, selector: 'h1' },
		screenshotName: 'run-detail.png',
		specialSetup: 'resolve-first-existing-run; local-empty-db-creates-demo-fixture',
	},
	{
		routePattern: '/evidence',
		smokeURL: '/evidence',
		requiresFixture: false,
		expectedPageSignal: { role: 'heading', name: 'Evidence' },
		screenshotName: 'evidence.png',
		specialSetup: 'none',
	},
	{
		routePattern: '/projects',
		smokeURL: '/projects',
		requiresFixture: false,
		expectedPageSignal: { role: 'heading', name: 'Managed Target Projects' },
		screenshotName: 'projects.png',
		specialSetup: 'none',
	},
	{
		routePattern: '/repos',
		smokeURL: '/repos',
		requiresFixture: false,
		expectedPageSignal: { role: 'heading', name: /Repositories/ },
		screenshotName: 'repositories.png',
		specialSetup: 'none',
	},
	{
		routePattern: '/evolution',
		smokeURL: '/evolution',
		requiresFixture: false,
		expectedPageSignal: { role: 'heading', name: /Harness Evolution/ },
		screenshotName: 'evolution.png',
		specialSetup: 'none',
	},
	{
		routePattern: '/settings',
		smokeURL: '/settings',
		requiresFixture: false,
		expectedPageSignal: { role: 'heading', name: 'Settings' },
		screenshotName: 'settings.png',
		specialSetup: 'none',
	},
	{
		routePattern: '/admin',
		smokeURL: '/admin',
		requiresFixture: false,
		expectedPageSignal: { role: 'heading', name: 'Admin Dashboard' },
		screenshotName: 'admin.png',
		specialSetup: 'none',
	},
] as const;

export function getRouteSmokeTarget(rawValue: string | undefined): RouteSmokeTarget {
	if (rawValue === undefined) {
		return {
			baseURL: `http://localhost:${TEST_WEB_PORT}/`,
			mode: 'local',
			source: 'playwright-webServer',
			redactedURL: `http://localhost:${TEST_WEB_PORT}/`,
		};
	}

	if (rawValue.trim() === '') {
		throw new Error(`${ROUTE_SMOKE_BASE_URL_ENV} must be a non-empty absolute URL when set`);
	}

	let parsed: URL;
	try {
		parsed = new URL(rawValue);
	} catch {
		throw new Error(`${ROUTE_SMOKE_BASE_URL_ENV} must be a valid absolute URL`);
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`${ROUTE_SMOKE_BASE_URL_ENV} must use http or https`);
	}
	if (parsed.username || parsed.password) {
		throw new Error(`${ROUTE_SMOKE_BASE_URL_ENV} must not contain credentials`);
	}
	if (parsed.search || parsed.hash) {
		throw new Error(`${ROUTE_SMOKE_BASE_URL_ENV} must not contain a query or fragment`);
	}
	if (parsed.pathname !== '/') {
		throw new Error(`${ROUTE_SMOKE_BASE_URL_ENV} must target the Positron origin root`);
	}

	return {
		baseURL: parsed.toString(),
		mode: 'external',
		source: ROUTE_SMOKE_BASE_URL_ENV,
		redactedURL: `${parsed.origin}/`,
	};
}

export function extractNamedAppRoutes(appSource: string): string[] {
	const routes: string[] = [];
	const routePattern = /<Route\s+path=["']([^"']+)["']/g;

	for (const match of appSource.matchAll(routePattern)) {
		const route = match[1];
		if (route && route !== '*') routes.push(route);
	}

	return routes;
}

export function getRouteManifestDrift(appSource: string): string[] {
	const sourceRoutes = extractNamedAppRoutes(appSource);
	const manifestRoutes = ROUTE_SMOKE_MANIFEST.map((entry) => entry.routePattern);
	const errors: string[] = [];

	if (new Set(manifestRoutes).size !== manifestRoutes.length) {
		errors.push('route smoke manifest contains duplicate route patterns');
	}

	const sourceSet = new Set(sourceRoutes);
	const manifestSet = new Set(manifestRoutes);
	for (const route of sourceRoutes) {
		if (!manifestSet.has(route)) errors.push(`App route missing from manifest: ${route}`);
	}
	for (const route of manifestRoutes) {
		if (!sourceSet.has(route)) errors.push(`Manifest route missing from App.tsx: ${route}`);
	}

	return errors;
}

export function resolveSmokeURL(entry: RouteSmokeManifestEntry, runId?: string | null): string {
	if (entry.routePattern === '/runs/:id') {
		if (!runId) throw new Error('Cannot resolve /runs/:id without an existing run ID');
		return `/runs/${encodeURIComponent(runId)}`;
	}
	return entry.smokeURL;
}

export function sanitizeScreenshotName(name: string): string {
	const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[.-]+|[-.]+$/g, '');
	return sanitized || 'route.png';
}

export function hasMeaningfulPageContent(bodyText: string, rootText: string): boolean {
	return bodyText.trim().length > 0 && rootText.trim().length > 0;
}

export function isUnexpectedConsoleError(message: string): boolean {
	return message.trim().length > 0;
}
