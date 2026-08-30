// Positron — Real Git Workspace Adapter

import fs from 'node:fs';
import path from 'node:path';
import type {
	GitDiffSummary,
	GitStatusSummary,
	GitWorkspaceAdapter,
	PreparedWorkspace,
	PrepareWorkspaceInput,
	PushOptions,
} from '@positron/shared';
import { GitCommandError, GitCommandFailedError, runCommand } from './command-runner.js';
import { evaluatePushPolicy, generateCommitMessage } from './commit-policy.js';
import { validatePath, validateRemoteUrl } from './paths.js';
import {
	acquireExternalMutationLock,
	assertExternalMutationWriter,
	getExternalMutationLock,
	openMutationLockDatabase,
	releaseExternalMutationLock,
} from './persistent-mutation-lock.js';

/**
 * Echter Git-Workspace-Adapter.
 * Führt echte Git-Operationen via child_process aus.
 */
export class RealGitWorkspaceAdapter implements GitWorkspaceAdapter {
	/**
	 * In-process lock tracking: workspacePath → ownerRunId.
	 *
	 * Issue #244 Limitation: This lock is PROCESS-SCOPED only.
	 * It protects against concurrent access within a single Positron server process.
	 * It does NOT protect against multi-process or cluster deployments.
	 *
	 * For multi-process safety, a persistent lock store (e.g., lockfile with PID,
	 * SQLite advisory lock, or Redis lock) is required.
	 * See follow-up issue for persistent workspace lock store.
	 */
	private locks = new Map<string, { ownerId: string; generation: number }>();
	private lockDb = openMutationLockDatabase(
		process.env['POSITRON_DB_PATH'] ?? path.join(process.cwd(), '.positron', 'positron.db'),
	);
	/** Workspace root for boundary validation */
	private workspaceRoot: string;

	constructor() {
		this.workspaceRoot =
			process.env['POSITRON_WORKSPACE_ROOT'] ?? path.join(process.cwd(), '.positron', 'workspaces');
	}
	async prepareWorkspace(input: PrepareWorkspaceInput): Promise<PreparedWorkspace> {
		const { repository, issueNumber, issueTitle, runId, baseBranch } = input;
		validateRemoteUrl(repository.remoteUrl);

		const workspacePath = path.join(
			process.env['POSITRON_WORKSPACE_ROOT'] ?? path.join(process.cwd(), '.positron', 'workspaces'),
			runId.slice(0, 8),
		);

		const branchName = `positron/issue-${issueNumber}-${issueTitle
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 50)}`;

		const defaultBranch = baseBranch ?? 'main';
		let isNewClone = false;
		let isNewBranch = false;

		if (!fs.existsSync(workspacePath)) {
			// Repository klonen
			fs.mkdirSync(workspacePath, { recursive: true });
			const result = await runCommand('git', ['clone', repository.remoteUrl, workspacePath], {
				cwd: process.cwd(),
				timeout: 300_000,
			});
			if (result.exitCode !== 0) {
				throw new GitCommandFailedError('git clone', result.exitCode ?? 1, result.stderr);
			}
			isNewClone = true;
		}

		// Branch erstellen/wechseln
		const branchResult = await runCommand('git', ['checkout', '-b', branchName], {
			cwd: workspacePath,
			timeout: 30_000,
		});

		if (branchResult.exitCode !== 0) {
			// Branch existiert bereits — einfach checkout
			await runCommand('git', ['checkout', branchName], {
				cwd: workspacePath,
				timeout: 30_000,
			});
		} else {
			isNewBranch = true;
		}

		// SHA abrufen
		const shaResult = await runCommand('git', ['rev-parse', 'HEAD'], {
			cwd: workspacePath,
			timeout: 10_000,
		});
		const headSha = shaResult.stdout.trim();

		return {
			runId,
			owner: repository.owner,
			repo: repository.repo,
			workspacePath,
			branchName,
			baseBranch: defaultBranch,
			defaultBranch,
			headSha,
			isNewClone,
			isNewBranch,
		};
	}

	async getStatus(workspacePath: string): Promise<GitStatusSummary> {
		validatePath(workspacePath);

		const result = await runCommand('git', ['status', '--porcelain'], {
			cwd: workspacePath,
			timeout: 10_000,
		});

		const lines = result.stdout.trim().split('\n').filter(Boolean);
		const staged: string[] = [];
		const unstaged: string[] = [];
		const untracked: string[] = [];
		const conflicted: string[] = [];

		for (const line of lines) {
			const status = line.slice(0, 2);
			const file = line.slice(3);
			if (status === '??') {
				untracked.push(file);
			} else if (status[0] !== ' ') {
				staged.push(file);
			}
			if (status[1] !== ' ' && status[1] !== '?' && status[0] === ' ') {
				unstaged.push(file);
			}
			if (status.includes('U') || status.includes('DD') || status.includes('AA')) {
				conflicted.push(file);
			}
		}

		// Branch ermitteln
		const branchResult = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			cwd: workspacePath,
			timeout: 5_000,
		});

		return {
			branch: branchResult.stdout.trim(),
			isClean: lines.length === 0,
			ahead: 0,
			behind: 0,
			staged,
			unstaged,
			untracked,
			conflicted,
		};
	}

	async getDiff(
		workspacePath: string,
		options?: { staged?: boolean; baseRef?: string },
	): Promise<GitDiffSummary> {
		validatePath(workspacePath);

		const args = ['diff'];
		if (options?.staged) args.push('--cached');
		if (options?.baseRef) args.push(options.baseRef);

		const result = await runCommand('git', args, {
			cwd: workspacePath,
			timeout: 10_000,
		});

		const raw = result.stdout;
		const filesChanged = raw.split('\ndiff --git ').length - 1;

		// Einfügungen und Löschungen zählen
		let insertions = 0;
		let deletions = 0;
		for (const line of raw.split('\n')) {
			if (line.startsWith('+') && !line.startsWith('+++')) insertions++;
			if (line.startsWith('-') && !line.startsWith('---')) deletions++;
		}

		return { raw, filesChanged, insertions, deletions };
	}

	async getCurrentBranch(workspacePath: string): Promise<string> {
		validatePath(workspacePath);
		const result = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			cwd: workspacePath,
			timeout: 5_000,
		});
		return result.stdout.trim();
	}

	async getHeadSha(workspacePath: string): Promise<string> {
		validatePath(workspacePath);
		const result = await runCommand('git', ['rev-parse', 'HEAD'], {
			cwd: workspacePath,
			timeout: 5_000,
		});
		return result.stdout.trim();
	}

	async validateWorkspacePath(workspacePath: string): Promise<void> {
		validatePath(workspacePath);
		if (!fs.existsSync(workspacePath)) {
			throw new GitCommandError(`Workspace path does not exist: "${workspacePath}"`);
		}
	}

	async commit(workspacePath: string, message: string): Promise<{ sha: string }> {
		validatePath(workspacePath);

		// Stage all changes
		await runCommand('git', ['add', '-A'], { cwd: workspacePath, timeout: 30_000 });

		// Commit
		const result = await runCommand('git', ['commit', '-m', message], {
			cwd: workspacePath,
			timeout: 30_000,
		});

		if (result.exitCode !== 0) {
			throw new GitCommandFailedError('git commit', result.exitCode ?? 1, result.stderr);
		}

		const shaResult = await runCommand('git', ['rev-parse', 'HEAD'], {
			cwd: workspacePath,
			timeout: 5_000,
		});

		return { sha: shaResult.stdout.trim() };
	}

	async push(options: PushOptions): Promise<{ pushed: boolean; ref: string }> {
		const { workspacePath, branch, remote } = options;

		validatePath(workspacePath);
		const held = this.locks.get(workspacePath);
		if (!held) throw new GitCommandError('External mutation blocked: persistent lock is required');
		assertExternalMutationWriter(this.lockDb, {
			resource_key: workspacePath,
			owner_id: held.ownerId,
			generation: held.generation,
		});

		// Push-Policy prüfen
		const policy = evaluatePushPolicy(branch, []);
		if (!policy.allowed) {
			throw new GitCommandError(`Push blocked: ${policy.reason ?? 'unknown'}`);
		}

		const remoteName = remote ?? 'origin';
		const result = await runCommand('git', ['push', remoteName, branch], {
			cwd: workspacePath,
			timeout: 120_000,
		});

		if (result.exitCode !== 0) {
			throw new GitCommandFailedError('git push', result.exitCode ?? 1, result.stderr);
		}

		return { pushed: true, ref: `${remoteName}/${branch}` };
	}

	// ── Issue #244: Workspace Lifecycle ──

	/**
	 * Validates a workspace path is within the workspace root boundary.
	 * Blocks empty, root, and path-traversal paths.
	 */
	private validateWorkspaceBoundary(workspacePath: string): { ok: boolean; reason?: string } {
		if (!workspacePath || workspacePath.trim() === '') {
			return { ok: false, reason: 'Rejected: empty workspace path' };
		}
		const resolved = path.resolve(workspacePath);
		// Block root and near-root paths
		const rootResolved = path.resolve('/');
		if (resolved === rootResolved) {
			return { ok: false, reason: 'Rejected: root path is not a valid workspace' };
		}
		// Block paths that are not under the workspace root
		const normalizedRoot = path.resolve(this.workspaceRoot);
		if (!resolved.startsWith(normalizedRoot)) {
			return {
				ok: false,
				reason: `Rejected: path "${workspacePath}" is outside workspace root`,
			};
		}
		// Block path traversal patterns
		const normalized = path.normalize(workspacePath);
		if (normalized.includes('..')) {
			return {
				ok: false,
				reason: `Rejected: path traversal detected in "${workspacePath}"`,
			};
		}
		return { ok: true };
	}

	async destroyWorkspace(workspacePath: string): Promise<{ destroyed: boolean; reason?: string }> {
		const boundary = this.validateWorkspaceBoundary(workspacePath);
		if (!boundary.ok) {
			return { destroyed: false, reason: boundary.reason };
		}
		const resolved = path.resolve(workspacePath);
		// Idempotent: workspace already gone
		if (!fs.existsSync(resolved)) {
			const held = this.locks.get(workspacePath);
			if (held) {
				releaseExternalMutationLock(this.lockDb, {
					resource_key: workspacePath,
					owner_id: held.ownerId,
					generation: held.generation,
				});
			}
			this.locks.delete(workspacePath);
			return { destroyed: true, reason: 'Workspace already removed (idempotent)' };
		}
		try {
			fs.rmSync(resolved, { recursive: true, force: true });
			this.locks.delete(workspacePath);
			return { destroyed: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { destroyed: false, reason: `Failed to destroy workspace: ${msg}` };
		}
	}

	async lockWorkspace(
		workspacePath: string,
		ownerRunId: string,
	): Promise<{ locked: boolean; reason?: string }> {
		if (!workspacePath || !ownerRunId) {
			return { locked: false, reason: 'Workspace path and ownerRunId are required' };
		}
		const existing = getExternalMutationLock(this.lockDb, workspacePath);
		const acquired = acquireExternalMutationLock(this.lockDb, workspacePath, ownerRunId, 600_000);
		if (!acquired)
			return {
				locked: false,
				reason: `Workspace already locked by run "${existing?.owner_id ?? 'unknown'}"`,
			};
		this.locks.set(workspacePath, { ownerId: ownerRunId, generation: acquired.generation });
		if (existing?.owner_id === ownerRunId && existing.status === 'ACTIVE')
			return { locked: true, reason: 'Already locked by same owner (idempotent)' };
		return { locked: true };
	}

	async unlockWorkspace(
		workspacePath: string,
		ownerRunId: string,
	): Promise<{ unlocked: boolean; reason?: string }> {
		if (!workspacePath || !ownerRunId) {
			return { unlocked: false, reason: 'Workspace path and ownerRunId are required' };
		}
		const held = this.locks.get(workspacePath);
		if (!held) {
			return { unlocked: true, reason: 'Not locked (idempotent)' };
		}
		if (held.ownerId !== ownerRunId) {
			return {
				unlocked: false,
				reason: `Cannot unlock: workspace owned by "${held.ownerId}", not "${ownerRunId}"`,
			};
		}
		releaseExternalMutationLock(this.lockDb, {
			resource_key: workspacePath,
			owner_id: ownerRunId,
			generation: held.generation,
		});
		this.locks.delete(workspacePath);
		return { unlocked: true };
	}

	async isLocked(workspacePath: string): Promise<{ locked: boolean; ownerRunId?: string }> {
		const lock = getExternalMutationLock(this.lockDb, workspacePath);
		if (lock?.status === 'ACTIVE' && new Date(lock.expires_at).getTime() > Date.now()) {
			return { locked: true, ownerRunId: lock.owner_id };
		}
		return { locked: false };
	}
}
