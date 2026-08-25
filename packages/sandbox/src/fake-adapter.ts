// Positron — Fake Git Workspace Adapter (für Tests)

import type {
	GitDiffSummary,
	GitStatusSummary,
	GitWorkspaceAdapter,
	PreparedWorkspace,
	PrepareWorkspaceInput,
	PushOptions,
} from '@positron/shared';

/**
 * Fake-Git-Workspace-Adapter für Tests.
 * Simuliert alle Git-Operationen ohne echte Git-Calls.
 *
 * Dirty-State wird pro Workspace über eine Map<string, boolean> getrackt.
 * Standardmäßig ist der Workspace nach prepareWorkspace() dirty (simuliert Änderungen),
 * damit die Pipeline vollständig durchlaufen kann. Tests können simulateChange()
 * oder simulateFileChange() für granulare Kontrolle nutzen.
 */
export class FakeGitWorkspaceAdapter implements GitWorkspaceAdapter {
	private workspaces = new Map<string, PreparedWorkspace>();
	private fileStates = new Map<string, Map<string, string>>();
	private workspaceDirty = new Map<string, boolean>();
	private workspaceToRunId = new Map<string, string>();
	/** Lock tracking: workspacePath → ownerRunId */
	private locks = new Map<string, string>();
	/** Destroyed workspace tracking for idempotency */
	private destroyed = new Set<string>();

	async prepareWorkspace(input: PrepareWorkspaceInput): Promise<PreparedWorkspace> {
		const { repository, issueNumber, issueTitle, runId, baseBranch } = input;

		const workspacePath = `/tmp/positron-fake-${runId.slice(0, 8)}`;
		const branchName = `positron/issue-${issueNumber}-${issueTitle
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 50)}`;

		const workspace: PreparedWorkspace = {
			runId,
			owner: repository.owner,
			repo: repository.repo,
			workspacePath,
			branchName,
			baseBranch: baseBranch ?? 'main',
			defaultBranch: baseBranch ?? 'main',
			headSha: 'fake-sha-abc123',
			isNewClone: true,
			isNewBranch: true,
		};

		this.workspaces.set(runId, workspace);
		this.fileStates.set(runId, new Map());
		this.workspaceToRunId.set(workspacePath, runId);
		// Starte mit simulierten Änderungen — ermöglicht vollständige Pipeline-Durchläufe
		this.workspaceDirty.set(workspacePath, true);

		return workspace;
	}

	/**
	 * Markiert einen Workspace als dirty (simuliert uncommittete Änderungen).
	 * Muss nach prepareWorkspace() aufgerufen werden, bevor commit() erfolgreich ist.
	 */
	simulateChange(workspacePath: string): void {
		this.workspaceDirty.set(workspacePath, true);
	}

	/**
	 * Simuliert eine Dateiänderung in einem Workspace.
	 * Setzt dirty-flag und trägt die Datei in fileStates ein.
	 */
	simulateFileChange(workspacePath: string, filename: string): void {
		this.workspaceDirty.set(workspacePath, true);
		const runId = this.workspaceToRunId.get(workspacePath);
		if (runId) {
			const files = this.fileStates.get(runId);
			if (files) {
				files.set(filename, 'modified');
			}
		}
	}

	async getStatus(workspacePath: string): Promise<GitStatusSummary> {
		const isDirty = this.workspaceDirty.get(workspacePath) ?? false;

		// Lies die tatsächlich simulierten Dateien, falls vorhanden
		const runId = this.workspaceToRunId.get(workspacePath);
		const simulatedFiles: string[] = [];
		if (runId) {
			const files = this.fileStates.get(runId);
			if (files && files.size > 0) {
				simulatedFiles.push(...files.keys());
			}
		}

		return {
			branch: this._currentBranch ?? 'positron/issue-42-fake',
			isClean: !isDirty,
			ahead: isDirty ? 1 : 0,
			behind: 0,
			staged: isDirty
				? simulatedFiles.length > 0
					? simulatedFiles
					: ['README.md', 'src/index.ts']
				: [],
			unstaged: [],
			untracked: [],
			conflicted: [],
		};
	}

	private _currentBranch: string | null = null;

	async getDiff(
		_workspacePath: string,
		_options?: { staged?: boolean; baseRef?: string },
	): Promise<GitDiffSummary> {
		return {
			raw: 'diff --git a/fake.ts b/fake.ts\nindex abc..def 100644\n--- a/fake.ts\n+++ b/fake.ts\n@@ -1 +1 @@\n-old content\n+new content',
			filesChanged: 1,
			insertions: 1,
			deletions: 1,
		};
	}

	async getCurrentBranch(workspacePath: string): Promise<string> {
		return this._currentBranch ?? 'positron/issue-42-fake-branch';
	}

	async getHeadSha(_workspacePath: string): Promise<string> {
		return 'fake-sha-abc123';
	}

	async validateWorkspacePath(_workspacePath: string): Promise<void> {
		// Im Fake-Modus immer valide
	}

	async commit(workspacePath: string, _message: string): Promise<{ sha: string }> {
		const isDirty = this.workspaceDirty.get(workspacePath) ?? false;
		if (!isDirty) {
			throw new Error('NO_CHANGES_TO_COMMIT');
		}
		// Dirty-Flag nach erfolgreichem Commit zurücksetzen
		this.workspaceDirty.set(workspacePath, false);
		return { sha: `fake-commit-sha-${Date.now()}` };
	}

	async push(_options: PushOptions): Promise<{ pushed: boolean; ref: string }> {
		return { pushed: true, ref: `origin/${this._currentBranch ?? 'positron/issue-42-fake'}` };
	}

	// ── Issue #244: Workspace Lifecycle ──

	async destroyWorkspace(workspacePath: string): Promise<{ destroyed: boolean; reason?: string }> {
		// Validate workspace path
		if (!workspacePath || workspacePath.trim() === '') {
			return { destroyed: false, reason: 'Rejected: empty workspace path' };
		}
		if (workspacePath === '/' || workspacePath === '\\') {
			return { destroyed: false, reason: 'Rejected: root path is not a valid workspace' };
		}
		// Idempotent: already destroyed
		if (this.destroyed.has(workspacePath)) {
			return { destroyed: true, reason: 'Already destroyed (idempotent)' };
		}
		const runId = this.workspaceToRunId.get(workspacePath);
		if (runId) {
			this.workspaces.delete(runId);
			this.fileStates.delete(runId);
			this.workspaceToRunId.delete(workspacePath);
			this.workspaceDirty.delete(workspacePath);
			this.locks.delete(workspacePath);
		}
		this.destroyed.add(workspacePath);
		return { destroyed: true };
	}

	async lockWorkspace(
		workspacePath: string,
		ownerRunId: string,
	): Promise<{ locked: boolean; reason?: string }> {
		if (!workspacePath || !ownerRunId) {
			return { locked: false, reason: 'Workspace path and ownerRunId are required' };
		}
		const existingOwner = this.locks.get(workspacePath);
		if (existingOwner) {
			// Idempotent: same owner re-locking
			if (existingOwner === ownerRunId) {
				return { locked: true, reason: 'Already locked by same owner (idempotent)' };
			}
			return { locked: false, reason: `Workspace already locked by run "${existingOwner}"` };
		}
		this.locks.set(workspacePath, ownerRunId);
		return { locked: true };
	}

	async unlockWorkspace(
		workspacePath: string,
		ownerRunId: string,
	): Promise<{ unlocked: boolean; reason?: string }> {
		if (!workspacePath || !ownerRunId) {
			return { unlocked: false, reason: 'Workspace path and ownerRunId are required' };
		}
		const existingOwner = this.locks.get(workspacePath);
		if (!existingOwner) {
			return { unlocked: true, reason: 'Not locked (idempotent)' };
		}
		if (existingOwner !== ownerRunId) {
			return {
				unlocked: false,
				reason: `Cannot unlock: workspace owned by "${existingOwner}", not "${ownerRunId}"`,
			};
		}
		this.locks.delete(workspacePath);
		return { unlocked: true };
	}

	async isLocked(workspacePath: string): Promise<{ locked: boolean; ownerRunId?: string }> {
		const owner = this.locks.get(workspacePath);
		if (owner) {
			return { locked: true, ownerRunId: owner };
		}
		return { locked: false };
	}
}
