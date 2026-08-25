import { defineConfig } from 'vitest/config';

export default defineConfig({
	root: '.',
	test: {
		environment: 'node',
		include: ['e2e/support/route-smoke.test.ts'],
		reporters: ['verbose'],
	},
});
