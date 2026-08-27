# ADR: Stage 3 Runtime Foundation — Policy, Harness, and Writer Contracts

## Status

Proposed — July 2026  
**Updated — July 2026 (PR #370 integration):** Superseded values below are marked `HISTORICAL — SUPERSEDED by PR #370 integration (July 2026)`. All values now reflect the integrated Stage 3 modules (approval-binding, base-resolver, safety-probe, reader-verifier, bridge) as implemented and tested (345 tests across 10 test files).

## Context

Positron Stage 2 (single issue-comment write) is complete: the policy (`Stage2WriteSandboxPolicy`), the harness (`Stage2RuntimeWriteHarness`), and the single `Stage2IssueCommentWriter` interface have been validated through a real supervised write to the sandbox repository.

Stage 3 requires a different operation set — branch creation, file commit, and draft PR creation — all performed in a single, atomic-like sequence with the same zero-trust posture:

- Exactly 1 branch, 1 file, 1 commit, 1 draft PR.
- No merge, no production repo, no second mutation.
- Single process, queue disabled, workspace locked.
- Fine-grained PAT scoped to the sandbox only, revoked immediately after verification.
- Fake mode by default; live path implemented but never called with real credentials in this build.

The canonical target values are fixed in `docs/evidence/issue-308/stage3-supervised-pilot-approval-package.md`:

| Property | Value |
|----------|-------|
| Repository | `xxammaxx/positron-sandbox` |
| Branch | `positron/issue-308-stage3-pilot` (from `main`) |
| File | `stage3/positron-supervised-pilot.md` (1724 bytes, SHA-256: `73ac6e0f...`) — *Historical note: previously 1694 bytes, `0a97795fdc...` (see PR #370 integration update below)* |
| Commit | Exactly 1 (message: `feat(issue-308): stage 3 supervised real mode pilot`) |
| PR | Draft, exactly 1 (title: `feat(issue-308): Stage 3 supervised real mode pilot — sandbox marker`) |
| Merge | FORBIDDEN |
| Production repo | FORBIDDEN (`Mueller-Systems-Lab/Positron`) |

The design challenge: Stage 2 was a single-operation harness (validate → write comment). Stage 3 is a **multi-phase orchestrated sequence** (branch → file-commit → draft-PR) where partial failures are possible, state must be tracked across phases, and idempotency is scoped to the entire run, not to individual operations.

## Decision

Adopt a layered architecture matching the proven Stage 2 pattern but extended for multi-phase execution:

```
Stage3SupervisedPilotPolicy  (validation gatekeeper — 21+ gates)
         |
         | validates input, counts, process safety
         v
Stage3RuntimeHarness         (orchestrator — phase sequence + state tracking)
         |
         | calls through narrow writer interfaces
         v
Stage3BranchWriter           (createBranch)
Stage3FileCommitWriter       (commitFile — atomic create+commit)
Stage3PullRequestWriter      (createPullRequest — draft only)
         |
         | writers are injected (dependency inversion)
         v
FakeAdapter / RealAdapter    (existing FakeGitHubAdapter / RealGitHubAdapter)
```

Each layer is a **new, independent module** — Stage 3 does not extend, subclass, or overload Stage 2.

---

## 1. Stage3SupervisedPilotPolicy

### Location
`packages/github-adapter/src/stage3-supervised-pilot-policy.ts`

### Purpose
Pure validation gatekeeper. Validates every input parameter, enforces quantity limits, checks process-safety conditions, and produces structured results. Never executes writes, never contains tokens.

### Configuration

```ts
export interface Stage3PilotConfig {
  enabled: boolean;                       // false = block everything
  allowedRepository: string;              // e.g. 'xxammaxx/positron-sandbox'
  forbiddenRepositories: string[];        // e.g. ['Mueller-Systems-Lab/Positron']
  allowedBaseBranch: string;              // e.g. 'main'
  allowedTargetBranch: string;            // e.g. 'positron/issue-308-stage3-pilot'
  allowedFilePath: string;                // e.g. 'stage3/positron-supervised-pilot.md'
  expectedFileLength: number;             // e.g. 1724 (HISTORICAL: previously 1694 — superseded by PR #370 integration, July 2026)
  expectedFileSha256: string;             // e.g. '73ac6e0f...' (HISTORICAL: previously '0a97795fdc...' — superseded by PR #370 integration, July 2026)
  expectedCommitMessage: string;          // exact match required
  expectedPrTitle: string;                // exact match required
  expectedPrBody: string;                 // exact match required
  requireDraftPr: boolean;                // must be true

  // Quantity limits
  maxBranchCount: number;                 // 1
  maxFileWriteCount: number;              // 1
  maxCommitCount: number;                 // 1
  maxPullRequestCount: number;            // 1

  // Gates
  requireHumanApproval: boolean;          // true
  requirePreWritePreview: boolean;        // true
  requireDuplicateDetection: boolean;     // true
  requireQueueDisabled: boolean;          // true (POSITRON_DISABLE_QUEUE)
  requireSingleProcess: boolean;          // true (concurrency = 1)
  requireWorkspaceLock: boolean;          // true
  requireMergeKillSwitch: boolean;        // true
  requirePushDisabled: boolean;           // true
}
```

### Validation Gates (in order)

| # | Gate | Check |
|---|------|-------|
| 1 | Policy enabled | `this.config.enabled === true` |
| 2 | Repository allowed | `repository === allowedRepository` |
| 3 | Repository not forbidden | `repository NOT IN forbiddenRepositories` |
| 4 | Base branch allowed | `baseBranch === allowedBaseBranch` |
| 5 | Target branch allowed | `targetBranch === allowedTargetBranch` |
| 6 | File path allowed | `filePath === allowedFilePath` |
| 7 | File UTF-8 length match | `fileContent.length === expectedFileLength` |
| 8 | File SHA-256 match | `sha256(fileContent) === expectedFileSha256` |
| 9 | Commit message match | `commitMessage === expectedCommitMessage` |
| 10 | PR title match | `prTitle === expectedPrTitle` |
| 11 | PR body match | `prBody === expectedPrBody` |
| 12 | Draft enforcement | `draft === true` (when `requireDraftPr`) |
| 13 | Branch count | `branchCount < maxBranchCount` |
| 14 | File write count | `fileWriteCount < maxFileWriteCount` |
| 15 | Commit count | `commitCount < maxCommitCount` |
| 16 | PR count | `pullRequestCount < maxPullRequestCount` |
| 17 | Human approval | `humanApproved === true` |
| 18 | Pre-write preview | `previewGenerated === true` |
| 19 | Duplicate detection | idempotency key not previously used |
| 20 | Queue disabled | `POSITRON_DISABLE_QUEUE === 'true'` |
| 21 | Single process | concurrency = 1, no second active run |
| 22 | Workspace lock | lock acquired and held |
| 23 | Merge kill-switch | `POSITRON_MERGE_KILL_SWITCH === 'true'` |
| 24 | Push disabled | `POSITRON_ENABLE_PUSH !== 'true'` |

### Structured Result

```ts
export interface Stage3PilotValidationResult {
  allowed: boolean;
  blocked: boolean;                   // convenience: !allowed
  reason?: string;                    // human-readable denial reason
  failedGates: string[];              // names of gates that failed
  preview?: Stage3PilotPreview;       // only when allowed
  redactedAuditEvent?: Stage3PilotAuditEvent;  // always produced
}
```

### Preview (token-free, safe for logging)

```ts
export interface Stage3PilotPreview {
  stage: 'stage3-supervised-pilot';
  repository: string;
  baseBranch: string;
  targetBranch: string;
  filePath: string;
  fileLength: number;
  fileHash: string;                   // SHA-256 hex
  commitMessageHash: string;          // SHA-256 of commit message
  prTitleHash: string;                // SHA-256 of PR title
  prBodyHash: string;                 // SHA-256 of PR body
  prMetadataHash: string;             // composite hash
  idempotencyKey: string;
  branchCount: number;
  fileWriteCount: number;
  commitCount: number;
  pullRequestCount: number;
  tokenValue: 'REDACTED';
  timestamp: string;                  // ISO 8601
}
```

### Audit Event (JSONL-compatible, no tokens)

```ts
export interface Stage3PilotAuditEvent {
  stage: 'stage3-supervised-pilot';
  mode: 'fake' | 'preview' | 'live';
  phase: 'preflight' | 'branch' | 'file-commit' | 'pull-request' | 'verify' | 'complete';
  repository: string;
  targetBranch: string;
  filePath: string;
  fileHash?: string;
  commitHash?: string;
  prMetadataHash?: string;
  result: 'allowed_preview' | 'allowed_executed' | 'blocked';
  reason?: string;
  failedGates: string[];
  idempotencyKey: string;
  branchCount: number;
  fileWriteCount: number;
  commitCount: number;
  pullRequestCount: number;
  partialMutation: boolean;
  tokenValue: 'REDACTED';
  timestamp: string;
}
```

### Invariant: Never Raw Tokens
Every output path through the policy — previews, audit events, error messages — must force `tokenValue: 'REDACTED'`. The policy constructor never receives a token. The `redactValue()` utility from `@positron/shared` is applied to all dynamic strings before they enter audit events.

---

## 2. Stage3RuntimeHarness

### Location
`packages/github-adapter/src/stage3-runtime-harness.ts`

### Purpose
Orchestrates the multi-phase write sequence after policy validation. The harness owns the execution state machine: it tracks which phases have completed, detects partial mutations, and ensures no false success. It does not execute GitHub API calls directly — it calls through injected writer interfaces.

### Three Narrow Writer Interfaces

These interfaces are **defined inside the harness module** (colocated with the harness, not in `adapter.ts`), following the Stage 2 pattern of keeping writer contracts narrow and harness-specific.

```ts
/** Creates a branch on the target repository. */
export interface Stage3BranchWriter {
  createBranch(input: {
    owner: string;
    repo: string;
    branch: string;           // e.g. 'positron/issue-308-stage3-pilot' — NOTE: originally `branchName` in ADR draft
    sourceBranch: string;     // e.g. 'main'
    expectedSourceSha: string; // Added by PR #370 integration — TOCTOU protection via baseResolver.resolveBase()
  }): Promise<{
    ref: string;              // e.g. 'refs/heads/positron/issue-308-stage3-pilot'
    sha: string;              // commit SHA the branch points to
  }>;
}

/** Creates a file and commits it in a single atomic operation. */
export interface Stage3FileCommitWriter {
  commitFile(input: {
    owner: string;
    repo: string;
    branchName: string;       // target branch
    filePath: string;         // e.g. 'stage3/positron-supervised-pilot.md'
    fileContent: string;      // UTF-8 content
    commitMessage: string;    // exact commit message
    sha256: string;           // expected SHA-256 (writer verifies before upload)
  }): Promise<{
    commitSha: string;        // SHA of the new commit
    commitUrl: string;        // API URL of the commit
    contentSha: string;       // blob SHA of the file content
    contentUrl: string;       // API URL of the content
  }>;
}

/** Creates a Pull Request (draft only in Stage 3). */
export interface Stage3PullRequestWriter {
  createPullRequest(input: {
    owner: string;
    repo: string;
    head: string;             // branch name
    base: string;             // e.g. 'main'
    title: string;
    body: string;
    draft: boolean;           // must be true for Stage 3
  }): Promise<{
    prNumber: number;
    prUrl: string;            // HTML URL
    prId: number;
    state: string;            // 'open'
    draft: boolean;
    createdAt: string;
  }>;
}
```

### Harness Configuration

```ts
export interface Stage3HarnessConfig {
  enabled: boolean;
  fakeMode: boolean;          // true = simulate, false = real writes
}
```

### Execution State Model

```ts
export interface Stage3ExecutionState {
  branchCount: number;        // 0 or 1
  fileWriteCount: number;     // 0 or 1
  commitCount: number;        // 0 or 1
  pullRequestCount: number;   // 0 or 1
  currentPhase: Stage3Phase;
  writeExecuted: boolean;     // true if any real write occurred
  partialMutation: boolean;   // true if sequence started but incomplete
  idempotencyKey: string;
}

export type Stage3Phase =
  | 'idle'
  | 'preflight'
  | 'policy-check'
  | 'preview'
  | 'audit-pre-write'
  | 'branch'
  | 'file-commit'
  | 'pull-request'
  | 'verify'
  | 'complete'
  | 'failed';
```

### Execution Flow

```
PREFLIGHT
  ├── Harness enabled?
  ├── Queue disabled? (POSITRON_DISABLE_QUEUE=true)
  ├── Single process? (concurrency = 1)
  ├── Workspace lock acquired?
  ├── No second active run?
  └── If any fail → audit(blocked), return { success: false }
       │
       v
POLICY VALIDATION (Stage3SupervisedPilotPolicy.validate)
  ├── All 24 gates checked
  └── If any fail → audit(blocked), return { success: false, failedGates }
       │
       v
PREVIEW GENERATION (policy.generatePreview)
  ├── Token-free preview produced
  └── Returned to caller for human inspection (if not already done)
       │
       v
AUDIT PRE-WRITE (audit sink: allowed_preview, phase=preflight)
       │
       v
PHASE: BRANCH (phase='branch')
  ├── Fake mode? → simulated result, state.branchCount++ (simulated)
  ├── Live mode? → adapter.createBranch(...), state.branchCount++
  ├── On failure → state.partialMutation=true, audit(blocked), ABORT
  └── On success → advance to next phase
       │
       v
PHASE: FILE-COMMIT (phase='file-commit')
  ├── Fake mode? → simulated result, state.fileWriteCount++, state.commitCount++
  ├── Live mode? → adapter.commitFile(...), state.fileWriteCount++, state.commitCount++
  ├── On failure → state.partialMutation=true, audit(blocked), ABORT
  └── On success → advance to next phase
       │
       v
PHASE: PULL-REQUEST (phase='pull-request')
  ├── Fake mode? → simulated result, state.pullRequestCount++
  ├── Live mode? → adapter.createPullRequest(...), state.pullRequestCount++
  ├── On failure → state.partialMutation=true, audit(blocked), ABORT
  └── On success → advance to next phase
       │
       v
PHASE: VERIFY (phase='verify')
  ├── Fake mode? → skip (trust simulated state)
  ├── Live mode? → read-only verification:
  │     ├── PR exists on sandbox?
  │     ├── Branch exists?
  │     ├── File SHA-256 matches?
  │     └── Exactly 1 commit in branch?
  └── On mismatch → audit(blocked), ABORT
       │
       v
AUDIT POST-WRITE (audit sink: allowed_executed, phase=complete)
  └── Return { success: true, writeExecuted: true/false, state }
```

### Partial Failure Handling

- **No auto-retry**: If any phase fails, the harness stops and returns the failure result. No retry loop.
- **No false success**: `writeExecuted` is only `true` if all phases completed successfully in live mode. A branch created but file-commit failed → `writeExecuted=false`, `partialMutation=true`.
- **Partial state exposed**: The returned result includes `partialMutation: true` and the `currentPhase` where the failure occurred. This enables the caller (or a human operator) to diagnose residual state on the sandbox repository.

### Idempotency

- The idempotency key is scoped to the **entire run**, not to individual phases.
- Second call with the same idempotency key → **BLOCK** (reason: "Duplicate idempotency key").
- The idempotency key is registered **before** any write phase begins (in the policy validation phase), ensuring no double-execution window.
- In fake mode, the idempotency key is registered without incrementing write counters.

### Fake Mode vs Live Mode

| Aspect | Fake Mode | Live Mode |
|--------|-----------|-----------|
| Writer adapter | Fake/in-memory adapter | Real adapter (RealGitHubAdapter) |
| Network calls | None | GitHub API (Octokit) |
| Token | Not read, not required | Required (`POSITRON_STAGE3_GITHUB_TOKEN`) |
| Write counters | Simulated (incremented but `writeExecuted=false`) | Real (incremented, `writeExecuted=true`) |
| Verification | Skipped | Read-only GitHub API checks |
| Default | **YES** (this build run) | NO (gated behind explicit opt-in) |

### Build-Law Constraint

In this build run: **ONLY fake mode is callable**. The live path must be architecturally present (code compiles, interfaces accept real adapters, the execution path through `if (!fakeMode) { ... }` exists), but the harness constructor defaults to `fakeMode: true` and the factory does not expose a `fakeMode: false` option in this iteration. Real credentials are never read, stored, or passed.

---

## 3. Queue/Process Safety Design

The harness preflight includes process-safety checks that run **before** the policy validation (which runs before any write). These are defense-in-depth — enforced at the harness level even though the policy also checks them.

| Check | Variable/Mechanism | Block condition |
|-------|-------------------|-----------------|
| Queue disabled | `POSITRON_DISABLE_QUEUE` | Not `'true'` |
| Concurrency = 1 | Harness-scoped counter | `activeRunCount > 0` |
| Second process | Process-scoped singleton lock | Lock already held |
| Workspace lock | `isLocked()` from policy | `true` |
| Second active run | Harness instance flag | `this._runInProgress === true` |

The harness maintains an `_activeRunCount` and an `_runInProgress` flag. On entering `execute()`, it checks both. A second concurrent call to `execute()` returns `success: false` with reason `"Another Stage 3 run is in progress"`.

The workspace lock is consulted from the policy (which in turn checks the file-system or in-memory lock managed by `packages/sandbox`). If locked, the harness aborts.

---

## 4. Quantity/State Model

### Tracked Quantities

```ts
branchCount: number;        // 0 before first branch write
fileWriteCount: number;     // 0 before first file write
commitCount: number;        // 0 before first commit
pullRequestCount: number;   // 0 before first PR creation
```

### Hard Limits (from config, all = 1 for Stage 3)

- `branchCount ≤ maxBranchCount` (1)
- `fileWriteCount ≤ maxFileWriteCount` (1)
- `commitCount ≤ maxCommitCount` (1)
- `pullRequestCount ≤ maxPullRequestCount` (1)

### Counting Rules

- **Fake mode**: Counters are incremented (for policy enforcement) but `writeExecuted` remains `false`.
- **Live mode**: Counters are incremented AND `writeExecuted` is set to `true` after the final phase completes.
- **On failure**: Counters for completed phases are NOT rolled back (they document what actually happened). `partialMutation` is set to `true`.
- **Reset**: `reset()` zeroes all counters and the idempotency key set. Required before a new run.

### Idempotency Key Lifecycle

1. Provided by caller in `Stage3HarnessInput`.
2. Checked in policy validation (gate 19).
3. If duplicate → `BLOCK`, no counters incremented.
4. If new → registered in `usedIdempotencyKeys` set BEFORE any write phase.
5. Registration is permanent within the harness lifetime (until `reset()`).

---

## 5. Audit Trail Design

### Audit Sink Interface (reused from Stage 2)

```ts
export interface Stage3AuditSink {
  record(event: Stage3PilotAuditEvent): void | Promise<void>;
}
```

### Audit Events Emitted

| When | Event Result | Phase |
|------|-------------|-------|
| Preflight failure | `blocked` | `preflight` |
| Policy validation fail | `blocked` | `policy-check` |
| Preview generated | `allowed_preview` | `preview` |
| Pre-write audit | `allowed_preview` | `audit-pre-write` |
| Branch success (fake) | `allowed_preview` | `branch` |
| Branch success (live) | `allowed_executed` | `branch` |
| Branch failure | `blocked` | `branch` |
| File-commit success (fake) | `allowed_preview` | `file-commit` |
| File-commit success (live) | `allowed_executed` | `file-commit` |
| File-commit failure | `blocked` | `file-commit` |
| PR success (fake) | `allowed_preview` | `pull-request` |
| PR success (live) | `allowed_executed` | `pull-request` |
| PR failure | `blocked` | `pull-request` |
| Verify failure | `blocked` | `verify` |
| Complete | `allowed_executed` | `complete` |

### What Is Redacted

Every audit event field that could contain secrets:
- The `tokenValue` field is hardcoded to `'REDACTED'`.
- All `reason` strings pass through `redactValue()` from `@positron/shared`.
- No raw GitHub API response bodies are included.
- No HTTP headers are included.
- File content is **never** included in audit events — only the SHA-256 hash and byte length.
- Commit messages and PR bodies are included only as SHA-256 hashes.

### What Is Included

- Structural metadata: repository, branch, file path, hashes, lengths.
- State counters: branchCount, fileWriteCount, commitCount, pullRequestCount.
- Phase tracking: currentPhase, partialMutation.
- Operation result: allowed_preview | allowed_executed | blocked.
- Failed gate names (for blocked events).
- Timestamp (ISO 8601).
- Mode (fake | preview | live).
- Idempotency key.

### Audit Sink Failure Handling

The audit sink is fire-and-forget within the harness. If `sink.record()` throws, the error is caught and swallowed — it must not block the write path. However, the preflight check verifies the audit sink is writable before any write phase begins (gate P13 in the approval package).

---

## 6. Component Dependency Graph

```text
                    ┌──────────────────────────────────────┐
                    │        Stage3RuntimeHarness           │
                    │  (orchestrator + state machine)       │
                    │                                       │
                    │  owns: Stage3ExecutionState           │
                    │  owns: Stage3AuditSink                │
                    │  calls: Stage3SupervisedPilotPolicy   │
                    │  calls: Stage3BranchWriter            │
                    │  calls: Stage3FileCommitWriter        │
                    │  calls: Stage3PullRequestWriter       │
                    └──────┬──────────┬──────────┬──────────┘
                           │          │          │
              ┌────────────┘          │          └────────────────┐
              v                       v                           v
┌─────────────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐
│ Stage3SupervisedPilot   │ │ Stage3Branch     │ │ Stage3FileCommit         │
│ Policy                  │ │ Writer           │ │ Writer                   │
│                         │ │ (interface)      │ │ (interface)              │
│ - validate()            │ │ - createBranch() │ │ - commitFile()           │
│ - generatePreview()     │ └────────┬─────────┘ └────────────┬─────────────┘
│ - createAuditEvent()    │          │                        │
│ - recordWrite()         │          │                        │
│ - getState()            │          │                        │
└─────────────────────────┘          │                        │
                                     │                        │
                          ┌──────────┴────────────┐ ┌─────────┴──────────────┐
                          │ Stage3PullRequest     │ │                        │
                          │ Writer                │ │                        │
                          │ (interface)           │ │                        │
                          │ - createPullRequest() │ │                        │
                          └───────────┬───────────┘ │                        │
                                      │             │                        │
                                      v             v                        v
                          ┌──────────────────────────────────────────────────┐
                          │           Adapter Implementations                 │
                          │                                                  │
                          │  FakeStage3Adapters (in-memory, no network)      │
                          │  RealGitHubAdapter  (wraps Octokit write methods) │
                          └──────────────────────────────────────────────────┘
```

### Key Dependency Rules

1. **Policy depends on nothing except `node:crypto` and `@positron/shared`.** It does not import the harness, the writers, or any adapter implementation.

2. **Harness depends on the Policy and the three Writer interfaces.** It does not depend on `RealGitHubAdapter`, `FakeGitHubAdapter`, or any Octokit code.

3. **Writer interfaces are defined in the harness module.** They are not added to `adapter.ts` (which defines the full `GitHubAdapter` interface). Each writer interface is narrow — exactly one method — and expresses only what Stage 3 needs.

4. **Adapter implementations** (`FakeGitHubAdapter` / `RealGitHubAdapter`) already implement methods that structurally satisfy the writer interfaces. `RealGitHubAdapter` has `createPullRequest()` with the right signature; the branch and file-commit methods need thin wrappers or direct Octokit calls. No changes to `adapter.ts` or `GitHubAdapter` are required.

5. **No circular dependencies.** The dependency graph is strictly acyclic: Policy ← Harness ← (Writer interfaces ← Adapter implementations).

---

## 7. Integration with Existing `index.ts` Exports

### New Exports

```ts
// --- Stage 3 Supervised Pilot Policy ---
export {
  Stage3SupervisedPilotPolicy,
  createStage3PilotPolicy,
  STAGE3_PILOT_DEFAULT_CONFIG,
} from './stage3-supervised-pilot-policy.js';
export type {
  Stage3PilotConfig,
  Stage3PilotValidationResult,
  Stage3PilotPreview,
  Stage3PilotAuditEvent,
} from './stage3-supervised-pilot-policy.js';

// --- Stage 3 Runtime Harness ---
export {
  Stage3RuntimeHarness,
  createStage3Harness,
} from './stage3-runtime-harness.js';
export type {
  Stage3BranchWriter,
  Stage3FileCommitWriter,
  Stage3PullRequestWriter,
  Stage3HarnessConfig,
  Stage3HarnessInput,
  Stage3HarnessResult,
  Stage3ExecutionState,
  Stage3Phase,
  Stage3AuditSink,
} from './stage3-runtime-harness.js';
```

### No Changes to Existing Exports

- `Stage2WriteSandboxPolicy` and `Stage2RuntimeWriteHarness` exports remain unchanged.
- `GitHubAdapter` and `ReadOnlyGitHubAdapter` remain unchanged.
- No existing export is removed or renamed.

---

## 7b. PR #370 Integration Update — Module Additions & Input Changes

PR #370 integrated five remediation modules into the `Stage3RuntimeHarness` and changed the input contract. These changes were not in the original ADR and are documented here as they occurred.

### 7b.1 New Remediation Modules

| Module | File | Purpose |
|--------|------|---------|
| `Stage3ApprovalBinding` | `stage3-approval-binding.ts` | Cryptographically signed approval binding replaces free `humanApproved` boolean in live mode |
| `Stage3BaseResolver` | `stage3-base-resolver.ts` | Resolves base branch SHA at runtime for TOCTOU protection |
| `Stage3RuntimeSafetyProbe` | `stage3-runtime-safety-probe.ts` | Runtime safety snapshot replaces caller-supplied `processSafety` booleans in live mode |
| `Stage3ReadOnlyVerifier` | `stage3-reader-verifier.ts` | Pre-write (`verifyPreWrite`) and post-write (`verifyPostWrite`) verification |
| `Stage3RealGitHubBridge` | `stage3-real-github-bridge.ts` | Factory `createStage3RealGitHubBridge()` with `kind: 'restricted-real-transport'`; `createMockStage3Bridge()` with `kind: 'mock'` (rejected in live mode) |

### 7b.2 Discriminated Input Union

Originally, `Stage3HarnessInput` was a flat interface. PR #370 changed it to a discriminated union:

```ts
type Stage3HarnessInput = Stage3FakeHarnessInput | Stage3LiveHarnessInput;
```

- **`Stage3FakeHarnessInput`**: retains `humanApproved?` boolean and `processSafety?` override for testability.
- **`Stage3LiveHarnessInput`**: requires `approvalText`, `approvalBinding`, `runtimeSafetyProbe`, `baseResolver`, `readOnlyVerifier`, `branchWriter`, `fileCommitWriter`, `pullRequestWriter`, and `auditSink`. No free booleans — all safety checks go through injected trusted modules.

### 7b.3 Canonical Values Update

| Property | Original (ADR) | Current (PR #370) |
|----------|---------------|-------------------|
| File byte length | 1694 | 1724 |
| File SHA-256 | `0a97795fdc...` | `73ac6e0f...` |

### 7b.4 Test Count Growth

| Metric | Original (ADR scope) | After PR #370 |
|--------|---------------------|---------------|
| Test files | 2 | 10 (all in `packages/github-adapter/src/__tests__/`) |
| Tests | 63 (37 policy + 26 harness) | 345 (37 policy + 27 harness + 47 remediation + 234 other adapter tests) |

---

## 8. Alternatives Considered

### Option A — Extend Stage 2 Policy and Harness

Add branch/file/PR validations to `Stage2WriteSandboxPolicy` and new phases to `Stage2RuntimeWriteHarness`.

**Benefits:**
- Fewer files, less module surface area.
- Reuses existing `Stage2IssueCommentWriter` pattern.

**Limitations:**
- Violates Single Responsibility — Stage 2 governs issue-scoped operations (comment, label, claim); Stage 3 governs repository-scoped operations (branch, file, PR). Mixing them creates a config matrix that is hard to reason about and test.
- Stage 2 has permanently forbidden operations (`createPullRequest`, `push`, `merge`). Adding those back into the same policy creates contradictory state.
- Stage 2 counts a single `writeCount`; Stage 3 needs per-operation-type counters. Refactoring Stage 2 to support multi-dimensional counting risks breaking existing Stage 2 tests (63 passing).
- The harness would need to support both single-operation and multi-phase execution modes, creating an untestable combinatorial surface.

**Verdict: REJECTED.** Clean separation is worth the extra module.

### Option B — Use Full GitHubAdapter Interface Directly

Define no new writer interfaces. The harness calls `GitHubAdapter.createPullRequest()` etc. directly.

**Benefits:**
- Zero new interface definitions.
- Directly compatible with existing `RealGitHubAdapter` and `FakeGitHubAdapter`.

**Limitations:**
- The harness would depend on the full `GitHubAdapter` interface (15+ methods), violating Interface Segregation. Tests would need a full `FakeGitHubAdapter` with all methods populated even though only 3 are called.
- Tight coupling: any change to `GitHubAdapter` or its method signatures forces regression testing of the entire Stage 3 harness.
- No compile-time guarantee that the adapter passed to the harness has exactly the three methods Stage 3 needs (e.g., a readonly adapter would pass type checks but fail at runtime).

**Verdict: REJECTED.** Narrow writer interfaces provide better testability, compile-time safety, and documentation of the harness's actual dependencies.

### Option C — Single Compound Writer Interface

One interface with three methods instead of three separate interfaces.

```ts
interface Stage3Writer {
  createBranch(...): Promise<...>;
  commitFile(...): Promise<...>;
  createPullRequest(...): Promise<...>;
}
```

**Benefits:**
- Simpler DI: inject one object instead of three.
- Slightly less boilerplate in the harness constructor.

**Limitations:**
- Forces all three write capabilities to be implemented by a single object, even if different implementations are optimal for different operations (e.g., a specialized file-commit service vs a generic GitHub client).
- Harder to mock in tests: a spy on `commitFile` shares the same mock object as `createBranch`, making per-method call assertions more fragile.
- Less explicit in the harness constructor: the dependency list (`branchWriter`, `fileCommitWriter`, `prWriter`) documents what the harness needs more clearly than a single `writer` parameter.

**Verdict: REJECTED.** Three separate interfaces follow Interface Segregation and make the harness's dependency contract self-documenting.

---

## 9. New Files Required

| File | Purpose |
|------|---------|
| `packages/github-adapter/src/stage3-supervised-pilot-policy.ts` | Policy validator (24 gates, preview, audit) |
| `packages/github-adapter/src/stage3-runtime-harness.ts` | Multi-phase orchestrator + 3 writer interfaces |
| `packages/github-adapter/src/__tests__/stage3-supervised-pilot-policy.test.ts` | Policy unit tests (all gates, preview, audit) |
| `packages/github-adapter/src/__tests__/stage3-runtime-harness.test.ts` | Harness integration tests (fake writers, state machine, audit) |

## 10. Files Modified

| File | Change |
|------|--------|
| `packages/github-adapter/src/index.ts` | Add Stage 3 exports (types, classes, factories) |

No other files modified. No changes to `adapter.ts`, `real-adapter.ts`, `fake-adapter.ts`, or any Stage 2 modules.

---

## 11. Open Design Questions / Tradeoffs

### Q1: Verification Phase in Fake Mode

In fake mode, the verify phase is skipped (trust simulated state). The alternative is to verify simulated state against the simulated adapter's internal maps. Skipping is simpler and avoids coupling the harness to the fake adapter's internal structure. But it means a fake run does not exercise the verification code path.

**Recommendation**: Skip in fake mode for now. Add a dedicated verification test that injects a spy writer and verifies the verify phase logic without requiring a full fake adapter.

### Q2: Where Does Workspace Lock Live?

The harness delegates workspace lock checking to the policy (gate 22), but the actual lock mechanism is owned by `packages/sandbox`. The policy needs a way to query the lock state without importing the sandbox package.

**Recommendation**: Pass a `workspaceLocked: boolean` flag in the `validate()` input, set by the harness after consulting the sandbox module's lock API. The policy itself only checks the boolean — it does not import sandbox code.

### Q3: RealGitHubAdapter Gap — createBranch and commitFile

`RealGitHubAdapter` has `createPullRequest()` but no `createBranch()` or `commitFile()` methods. The branch and file-commit writers need adapters.

**Recommendation**: Do NOT add `createBranch`/`commitFile` to the `GitHubAdapter` interface. Instead, create thin adapter wrappers in the test file (or a dedicated `stage3-real-writers.ts`) that wrap `RealGitHubAdapter`'s Octokit instance for these specific calls. This keeps `GitHubAdapter` stable and prevents the full interface from growing with Stage 3 concerns.

### Q4: Should the Policy Validate File Content or Just Metadata?

The Stage 3 approval package specifies the exact file content (originally 1694 bytes, SHA-256: `0a97795fdc...` — **HISTORICAL — SUPERSEDED by PR #370 integration (July 2026):** now 1724 bytes, SHA-256: `73ac6e0f...`). The policy accepts the full file content as a `validate()` parameter and computes the SHA-256 itself, or it can accept only the hash and length.

**Recommendation**: Accept the full content as a string. This allows the policy to independently compute the hash (trust but verify), and enables the `generatePreview()` to include the hash without the caller having to pre-compute it. The content is never included in audit events — only the hash and length.

### Q5: Concurrency Safety Without a Distributed Lock

The harness uses in-process flags (`_runInProgress`, `_activeRunCount`). This is sufficient for a single Node.js process. If two separate processes attempt a Stage 3 run simultaneously, the in-process flags cannot detect it.

**Recommendation**: Accept this limitation for Stage 3. The preflight check P11 (no orphaned workspace) provides defense in depth, and the approval package's operational constraints (human operator supervises a single run) make concurrent processes unlikely. A distributed lock (e.g., file lock, SQLite advisory lock) can be added in Stage 4 without changing the policy or harness contracts.

---

## 12. Consequences

### Positive

- **Clean separation**: Stage 2 and Stage 3 are independent modules with no shared mutable state, no inheritance, and no config interference.
- **Multi-phase integrity**: The harness state machine explicitly tracks `partialMutation`, preventing false success claims when a sequence fails mid-way.
- **Defense in depth**: Process-safety checks at the harness level, content validation at the policy level, and build-law constraints at the factory level.
- **Token safety**: The token is never in the policy, the harness, or any audit event. Only the injected writer adapter (injected by the caller, who owns the token) sees the token.
- **Testable in isolation**: Each component can be tested with fake/spy adapters. 24 policy gates can be tested independently. Harness state transitions can be tested with controlled writer failures.
- **Backward compatible**: No existing exports change. No existing tests break.

### Negative / Tradeoffs

- **Four new files**: Increases module count. Mitigated by clear file naming (`stage3-*`) and colocation within the existing package.
- **Not a general-purpose PR creation pipeline**: The harness is intentionally narrow — exactly 1 branch, 1 file, 1 commit, 1 draft PR. Generalization is deferred to Stage 4 or a dedicated issue.
- **No auto-rollback**: If the branch is created but the file-commit fails, the orphaned branch remains on the sandbox. The harness documents this as `partialMutation: true` but does not attempt cleanup. Cleanup is the operator's responsibility.

### Security Impact

- **Positive**: 24 validation gates with token-free audit trail. Zero chance of writing to the production repo (`Mueller-Systems-Lab/Positron` is explicitly forbidden in policy gate 3).
- **Positive**: Build-law constraint ensures no live writes in the current build iteration.
- **Neutral**: The live path exists in code but is unreachable through the factory defaults.
- **Neutral**: Concurrency protection is process-scoped, not distributed.

---

## Architecture Review Checklist

- [x] New dependency justified: No new npm dependencies. Uses `node:crypto` (built-in) and `@positron/shared` (existing).
- [x] Module coupling acceptable: Policy has zero imports from harness/writers/adapters. Harness depends on policy and writer interfaces. Writer interfaces are standalone. Adapter implementations are injected.
- [x] Data flow documented and secure: Token flows from environment → caller → adapter injection → adapter. Token never enters policy, harness, or audit events. File content enters policy for hash validation only; never included in audit output.
- [x] Error handling strategy consistent: All errors produce structured results (`Stage3HarnessResult` with `success: false`, `reason`, `failedGates`). Audit events are emitted before returning. No raw errors propagate.
- [x] Scaling bottlenecks identified: Single-run concurrency is intentionally enforced (not a bottleneck — a feature). Hard limits of 1 per operation type. No database or network contention.
- [x] Security boundaries clearly defined: Policy is pure validation (no network). Harness orchestrates but delegates writes to adapters. Token boundary is at adapter injection. Build-law constraint is at the factory level.
- [x] Testing strategy adequate: Unit tests for 24 policy gates. Integration tests for harness state machine with fake/spy writers. Verification phase tested with spy writer. All tests use fake/in-memory adapters — no real GitHub calls, no tokens.

---

## Follow-up

1. Implement `stage3-supervised-pilot-policy.ts` with all 24 gates, preview, and audit event generation.
2. Implement `stage3-runtime-harness.ts` with three writer interfaces, execution state machine, fake/live paths, and audit integration.
3. Write unit tests for policy (targeting 100% gate coverage).
4. Write integration tests for harness (targeting 100% state transition coverage).
5. Add exports to `index.ts`.
6. After approval: The live execution path will be activated in a separate, supervised session following the `stage3-supervised-pilot-next-run-prompt.md` execution prompt.
