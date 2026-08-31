import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [react()],
	resolve: {
		extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
	},
	server: {
		port: Number(process.env.POSITRON_TEST_WEB_PORT || '45100'),
		proxy: {
			'/api': {
				target: `http://localhost:${process.env.POSITRON_TEST_SERVER_PORT || '43100'}`,
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: 'dist',
		sourcemap: true,
		rollupOptions: {
			output: {
				manualChunks: {
					vendor: ['react', 'react-dom', 'react-router-dom'],
				},
			},
		},
	},
	esbuild: {
		jsx: 'automatic',
		jsxImportSource: 'react',
	},
	optimizeDeps: {
		esbuildOptions: {
			loader: {
				'.js': 'jsx',
				'.tsx': 'tsx',
			},
		},
	},
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/__tests__/setup.ts'],
		include: ['src/__tests__/**/*.test.{ts,tsx}', 'src/voice/__tests__/**/*.test.{ts,tsx}'],
		css: true,
	},
});
