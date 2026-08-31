import { describe, expect, test } from 'vitest';
import {
	getRouteManifestDrift,
	getRouteSmokeTarget,
	hasMeaningfulPageContent,
	isUnexpectedConsoleError,
	ROUTE_SMOKE_MANIFEST,
	resolveSmokeURL,
	sanitizeScreenshotName,
} from './route-smoke';

describe('route smoke target contract', () => {
	test('defaults to the self-started local target only when unset', () => {
		expect(getRouteSmokeTarget(undefined)).toMatchObject({
			baseURL: `http://localhost:${process.env.POSITRON_TEST_WEB_PORT || '45100'}/`,
			mode: 'local',
			source: 'playwright-webServer',
		});
	});

	test('uses an explicit external URL without falling back to localhost', () => {
		expect(getRouteSmokeTarget('https://ct-120.example.test')).toMatchObject({
			baseURL: 'https://ct-120.example.test/',
			mode: 'external',
			source: 'POSITRON_ROUTE_SMOKE_BASE_URL',
		});
	});

	test.each([
		'',
		'not-a-url',
		'ftp://example.test',
		'https://user:password@example.test',
		'https://example.test/?token=secret',
		'https://example.test/positron',
	])('rejects unsafe or malformed target %j', (value) => {
		expect(() => getRouteSmokeTarget(value)).toThrow();
	});
});

describe('route smoke manifest', () => {
	test('covers the current nine named application routes', () => {
		expect(ROUTE_SMOKE_MANIFEST.map((entry) => entry.routePattern)).toEqual([
			'/',
			'/runs',
			'/runs/:id',
			'/evidence',
			'/projects',
			'/repos',
			'/evolution',
			'/settings',
			'/admin',
		]);
	});

	test('detects route manifest drift against App.tsx declarations', () => {
		const source = `
			<Route path="/" />
			<Route path="/runs" />
			<Route path="/runs/:id" />
			<Route path="*" />
		`;
		expect(getRouteManifestDrift(source)).toEqual([
			'Manifest route missing from App.tsx: /evidence',
			'Manifest route missing from App.tsx: /projects',
			'Manifest route missing from App.tsx: /repos',
			'Manifest route missing from App.tsx: /evolution',
			'Manifest route missing from App.tsx: /settings',
			'Manifest route missing from App.tsx: /admin',
		]);
	});

	test('resolves parameterized routes only from a real run ID', () => {
		const entry = ROUTE_SMOKE_MANIFEST.find((item) => item.routePattern === '/runs/:id');
		expect(entry).toBeDefined();
		if (!entry) return;
		expect(resolveSmokeURL(entry, 'real-run-123')).toBe('/runs/real-run-123');
		expect(() => resolveSmokeURL(entry)).toThrow('existing run ID');
	});
});

describe('route smoke evidence helpers', () => {
	test('requires meaningful body and root content', () => {
		expect(hasMeaningfulPageContent('Dashboard', 'Dashboard')).toBe(true);
		expect(hasMeaningfulPageContent('Dashboard', '   ')).toBe(false);
		expect(hasMeaningfulPageContent('   ', 'Dashboard')).toBe(false);
	});

	test('does not silently discard console errors', () => {
		expect(isUnexpectedConsoleError('')).toBe(false);
		expect(isUnexpectedConsoleError('application failed')).toBe(true);
	});

	test('sanitizes screenshot filenames', () => {
		expect(sanitizeScreenshotName('../private?token.png')).toBe('private-token.png');
	});
});
