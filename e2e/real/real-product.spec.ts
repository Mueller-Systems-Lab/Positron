import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const issueUrl = process.env.REAL_E2E_ISSUE_URL!;
const canaryValue = process.env.REAL_E2E_CANARY_VALUE!;
const apiBase = `http://localhost:${process.env.REAL_E2E_SERVER_PORT ?? '46200'}`;
const adminToken = process.env.POSITRON_ADMIN_TOKEN!;
const evidenceDir = path.resolve('reports/ci/real-product-e2e');

test.describe('REAL_PRODUCT_E2E — sandbox runtime', () => {
	// Real SpecKit/OpenCode phases are bounded individually by the kernel
	// runtime budget, but the full sandbox Issue→PR journey needs room for
	// several sequential provider-backed phases.
	test.describe.configure({ timeout: 60 * 60 * 1000 });

	test.beforeAll(async () => {
		fs.mkdirSync(evidenceDir, { recursive: true });
		const response = await fetch(`${apiBase}/api/health`);
		expect(response.ok).toBe(true);
		const health = (await response.json()) as {
			adapters: Record<string, boolean>;
			integrationModes: Record<string, string>;
		};
		expect(health.integrationModes).toMatchObject({
			github: 'real',
			specKit: 'real',
			openCode: 'real',
			queue: 'bullmq',
		});
		expect(health.adapters).toMatchObject({ github: true, specKit: true, openCode: true });
		fs.writeFileSync(path.join(evidenceDir, 'health.json'), JSON.stringify(health, null, 2));
	});

	test('real sandbox issue is visible in the German product UI', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
		await expect(page.getByText('Übersicht der nachweisgesteuerten Agentenausführung')).toBeVisible();
		await page.screenshot({ path: path.join(evidenceDir, 'dashboard-de.png'), fullPage: true });
	});

	test('real issue is accepted by the real queue path', async ({ page }) => {
		await page.addInitScript(
			(token) => localStorage.setItem('positron_admin_token', token),
			adminToken,
		);
		await page.goto('/');
		await page.getByRole('button', { name: /Neuer Lauf/ }).click();
		await page.getByLabel('Issue-URL').fill(issueUrl);
		await page.getByRole('button', { name: 'Lauf starten', exact: true }).click();
		await expect(page).toHaveURL(/\/runs/);

		const response = await page.request.post(`${apiBase}/api/runs`, {
			headers: { 'X-Admin-Token': adminToken },
			data: { issueUrl, autonomyLevel: 2, forceRerun: true },
		});
		// The UI submission above is the user journey. The second intake is a
		// read/write API probe used only to obtain a stable correlation record;
		// duplicate intake is idempotent in the control plane.
		expect(response.ok()).toBe(true);
		const body = (await response.json()) as { queue_item_id?: string; runId?: string; message?: string };
		expect(body.queue_item_id ?? body.runId).toBeTruthy();

		const owner = process.env.POSITRON_REPO_OWNER!;
		const repo = process.env.POSITRON_REPO_NAME!;
		type RealRun = {
			id: string;
			repoId: string;
			issueNumber: number;
			status: string;
			phase: string;
			branch: string | null;
			workspacePath: string | null;
		};
		let observedRun: RealRun | undefined;
		await expect
			.poll(
				async () => {
					const runsResponse = await page.request.get(`${apiBase}/api/runs?limit=100`);
					const data = (await runsResponse.json()) as { runs: RealRun[] };
					observedRun = data.runs.find(
						(run) => run?.repoId === `${owner}/${repo}` && run.issueNumber === Number(issueUrl.match(/issues\/(\d+)/)?.[1]),
					) as typeof observedRun;
					return observedRun?.status ?? 'missing';
				},
				{ timeout: 55 * 60 * 1000, intervals: [1000, 3000, 10000] },
			)
			.toMatch(/^(done|blocked|cancelled|failed)$/);
		expect(observedRun?.status).toBe('done');
		expect(observedRun?.phase).toBe('DONE');
		expect(observedRun?.branch).toMatch(/^positron\/issue-/);

		const runDetails = await page.request.get(`${apiBase}/api/runs/${observedRun!.id}`);
		const detailBody = await runDetails.json();
		const controlPlaneResponse = await page.request.get(`${apiBase}/api/runs/${observedRun!.id}/control-plane`);
		const controlPlane = controlPlaneResponse.ok() ? await controlPlaneResponse.json() : null;
		const artifacts: Record<string, unknown> = {};
		for (const kind of ['spec', 'plan', 'tasks', 'diff']) {
			const artifactResponse = await page.request.get(`${apiBase}/api/runs/${observedRun!.id}/artifacts/${kind}`);
			artifacts[kind] = artifactResponse.ok() ? await artifactResponse.json() : null;
		}

		const prs = JSON.parse(
			execFileSync('gh', ['pr', 'list', '--repo', `${owner}/${repo}`, '--state', 'open', '--json', 'number,url,headRefName,title'], {
				encoding: 'utf8',
			}),
		) as Array<{ number: number; url: string; headRefName: string; title: string }>;
		const pr = prs.find((candidate) => candidate.headRefName === observedRun!.branch);
		expect(pr).toBeDefined();
		const fileCheck = JSON.parse(
			execFileSync('gh', ['api', `repos/${owner}/${repo}/contents/REAL_E2E_CANARY.md?ref=${observedRun!.branch}`], {
				encoding: 'utf8',
			}),
		) as { content?: string };
		expect(Buffer.from(fileCheck.content ?? '', 'base64').toString('utf8')).toContain(canaryValue);
		const issue = JSON.parse(
			execFileSync('gh', ['issue', 'view', String(Number(issueUrl.match(/issues\/(\d+)/)?.[1])), '--repo', `${owner}/${repo}`, '--json', 'url,title,body,state'], {
				encoding: 'utf8',
			}),
		) as { url: string; title: string; body: string; state: string };
		expect(issue.url).toBe(issueUrl);
		expect(`${issue.title}\n${issue.body}`).toContain(canaryValue);
		const prDiff = execFileSync('gh', ['pr', 'diff', String(pr!.number), '--repo', `${owner}/${repo}`], { encoding: 'utf8' });
		expect(prDiff).toContain(canaryValue);
		// The product intentionally removes terminal workspaces. Verify the
		// committed filesystem state independently by cloning the actual remote
		// branch after Positron reports DONE; do not depend on the UI or a stale
		// local workspace surviving cleanup.
		const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-real-proof-'));
		try {
			execFileSync('gh', [
				'repo',
				'clone',
				`${owner}/${repo}`,
				proofRoot,
				'--',
				'--branch',
				observedRun!.branch,
				'--depth',
				'1',
			]);
			const remoteCanaryPath = path.join(proofRoot, 'REAL_E2E_CANARY.md');
			expect(fs.existsSync(remoteCanaryPath)).toBe(true);
			expect(fs.readFileSync(remoteCanaryPath, 'utf8')).toContain(canaryValue);
		} finally {
			fs.rmSync(proofRoot, { recursive: true, force: true });
		}
		const commits = JSON.parse(
			execFileSync('gh', ['api', `repos/${owner}/${repo}/commits?sha=${observedRun!.branch}&per_page=1`], { encoding: 'utf8' }),
		) as Array<{ sha: string }>;
		const workerJob = Array.isArray(controlPlane?.jobs)
			? controlPlane.jobs.find((job: { job_type?: string }) => job.job_type === 'pipeline' || job.job_type === 'run')
			: null;

		fs.writeFileSync(
			path.join(evidenceDir, 'correlation.json'),
			JSON.stringify(
				{
					RUN_ID: observedRun!.id,
					SANDBOX_REPOSITORY: `${owner}/${repo}`,
					ISSUE_NUMBER: Number(issueUrl.match(/issues\/(\d+)/)?.[1]),
					ISSUE_URL: issueUrl,
					WORKTREE: observedRun!.workspacePath,
					BRANCH: observedRun!.branch,
					COMMIT_SHA: commits[0]?.sha ?? null,
					PR_NUMBER: pr!.number,
					PR_URL: pr!.url,
					SPEC_ARTIFACT_PATH: artifacts.spec ? `/api/runs/${observedRun!.id}/artifacts/spec` : null,
					PLAN_ARTIFACT_PATH: artifacts.plan ? `/api/runs/${observedRun!.id}/artifacts/plan` : null,
					TASKS_ARTIFACT_PATH: artifacts.tasks ? `/api/runs/${observedRun!.id}/artifacts/tasks` : null,
					TEST_RESULT: observedRun!.status,
					MODEL_PROVIDER: process.env.POSITRON_OPENCODE_PROVIDER ?? 'opencode',
					MODEL_ID: process.env.POSITRON_OPENCODE_MODEL,
					WORKER_JOB_ID: workerJob?.job_id ?? body.queue_item_id,
					FINAL_RUN_STATE: observedRun!.phase,
				},
				 null,
				2,
			),
		);
		fs.writeFileSync(path.join(evidenceDir, 'intake.json'), JSON.stringify({ issueUrl, ...body, detailBody }, null, 2));
	});
});
