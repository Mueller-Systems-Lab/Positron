#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../../', import.meta.url).pathname;
const env = {
	...process.env,
	BROWSER_E2E_MODE: 'REAL_PRODUCT',
	POSITRON_GITHUB_MODE: 'real',
	POSITRON_OPENCODE_MODE: 'real',
	POSITRON_SPECKIT_MODE: 'real',
	POSITRON_DISABLE_QUEUE: 'false',
	POSITRON_WORKSPACE_LOCK_TTL_MS: process.env.POSITRON_WORKSPACE_LOCK_TTL_MS ?? '3600000',
	REAL_E2E_SERVER_PORT: process.env.REAL_E2E_SERVER_PORT ?? '46200',
	REAL_E2E_WEB_PORT: process.env.REAL_E2E_WEB_PORT ?? '46201',
	POSITRON_TEST_SERVER_PORT: process.env.REAL_E2E_SERVER_PORT ?? '46200',
	POSITRON_TEST_WEB_PORT: process.env.REAL_E2E_WEB_PORT ?? '46201',
	POSITRON_REDIS_URL: process.env.POSITRON_REDIS_URL ?? 'redis://127.0.0.1:46379',
	POSITRON_ENABLE_REAL_SPECKIT: process.env.POSITRON_ENABLE_REAL_SPECKIT ?? 'true',
	POSITRON_ENABLE_PUSH: process.env.POSITRON_ENABLE_PUSH ?? 'true',
	// The real implement command must execute its tool calls. Without
	// --auto OpenCode can return successful text while making no workspace
	// change, which later appears as a misleading empty PR.
	POSITRON_OPENCODE_AUTO: process.env.POSITRON_OPENCODE_AUTO ?? 'true',
	POSITRON_ADMIN_TOKEN: process.env.POSITRON_ADMIN_TOKEN ?? 'positron-real-e2e-admin',
	POSITRON_WORKSPACE_ROOT:
		process.env.POSITRON_WORKSPACE_ROOT ?? '/tmp/positron-real-e2e-workspaces',
	POSITRON_DB_PATH: process.env.POSITRON_DB_PATH ?? '/tmp/positron-real-e2e.db',
	POSITRON_OPENCODE_MODEL: process.env.POSITRON_OPENCODE_MODEL ?? 'opencode/big-pickle',
	POSITRON_RUNTIME_ATTEMPT_BUDGET_MS: process.env.POSITRON_RUNTIME_ATTEMPT_BUDGET_MS ?? '3600000',
	POSITRON_RUNTIME_PROVIDER_BUDGET_MS: process.env.POSITRON_RUNTIME_PROVIDER_BUDGET_MS ?? '600000',
	PORT: process.env.REAL_E2E_SERVER_PORT ?? '46200',
};

if (!env.GITHUB_TOKEN?.trim()) {
	try {
		env.GITHUB_TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
	} catch {
		/* guard reports a useful failure */
	}
}
fs.mkdirSync(env.POSITRON_WORKSPACE_ROOT, { recursive: true });
execFileSync(process.execPath, ['scripts/ci/real-e2e-guard.mjs'], {
	cwd: root,
	env,
	stdio: 'inherit',
});

const redisPort = '46379';
const children = [];
const cleanup = () => {
	for (const child of children) {
		try {
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			try {
				child.kill('SIGTERM');
			} catch {
				/* already exited */
			}
		}
	}
};
const start = (command, args, extra = {}) => {
	const child = spawn(command, args, {
		cwd: root,
		env: { ...env, ...extra },
		stdio: 'inherit',
		detached: true,
	});
	children.push(child);
	return child;
};

start('redis-server', ['--port', redisPort, '--save', '', '--appendonly', 'no']);
for (let i = 0; i < 30; i += 1) {
	try {
		execFileSync('redis-cli', ['-p', redisPort, 'ping'], { stdio: 'ignore' });
		break;
	} catch {
		await delay(250);
	}
}
const workerChild = start(process.execPath, ['apps/worker/dist/index.js']);
const serverChild = start(process.execPath, ['apps/server/dist/index.js', '--port', env.PORT]);
const webChild = start('node_modules/.bin/vite', [
	'apps/web',
	'--port',
	env.REAL_E2E_WEB_PORT,
	'--strictPort',
]);
await delay(2500);
if (workerChild.exitCode !== null || serverChild.exitCode !== null || webChild.exitCode !== null) {
	cleanup();
	throw new Error(
		`REAL_PRODUCT_E2E runtime exited before Playwright startup (worker=${workerChild.exitCode}, server=${serverChild.exitCode}, web=${webChild.exitCode})`,
	);
}

let exitCode = 1;
try {
	const result = spawn(
		process.execPath,
		[
			'node_modules/@playwright/test/cli.js',
			'test',
			'--config=playwright.real.config.ts',
			'--headed',
		],
		{ cwd: root, env, stdio: 'inherit' },
	);
	exitCode = await new Promise((resolve) => result.on('exit', (code) => resolve(code ?? 1)));
} finally {
	cleanup();
}
process.exit(exitCode);
