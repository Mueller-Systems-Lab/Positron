import { defineConfig, devices } from '@playwright/test';

if (
	process.env.POSITRON_GITHUB_MODE !== 'real' ||
	process.env.POSITRON_OPENCODE_MODE !== 'real' ||
	process.env.POSITRON_SPECKIT_MODE !== 'real' ||
	process.env.POSITRON_DISABLE_QUEUE === 'true'
) {
	throw new Error('REAL_PRODUCT_E2E refuses fake adapters or the inline queue bypass');
}

export default defineConfig({
	testDir: './e2e/real',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'html',
	use: {
		...devices['Desktop Chrome'],
		baseURL: `http://localhost:${process.env.REAL_E2E_WEB_PORT ?? '46201'}`,
		trace: 'retain-on-failure',
		screenshot: 'on',
	},
});
