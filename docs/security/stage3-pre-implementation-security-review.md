# Positron Stage 3 — Pre-Implementation Security Review

**Date:** 2026-07-14  
**Reviewer:** Security Agent  
**Scope:** Stage 3 Supervised Sandbox Runtime (analysis only, no code changes)  
**Baseline:** `ea959dfb24cf4cadd1c018840ee7ce0683a28f4c`  
**PR #370 Integration (July 2026):** This review was pre-implementation. Integration of the five remediation modules (approval-binding, base-resolver, safety-probe, reader-verifier, bridge) is now complete. All 23 gaps identified below were addressed in implementation — see `docs/adr/ADR-stage3-remediation-design.md` and `docs/evidence/issue-308/stage3-runtime-foundation-implementation.md` for resolution details. The SHA-256 values referenced below have been superseded.

---

## Decision Summary

| Area | Stage 2 Pattern Sound? | Stage 3 Gaps | Risk |
|------|----------------------|-------------|------|
| 1. Secret Handling | Partially — redaction is regex-only, no token lifecycle | No token lifecycle enforcement, regex gaps for fine-grained PATs | **HIGH** |
| 2. Allowlist Enforcement | Solid structural pattern | Must extend to multi-operation; hash-binding critical | **MEDIUM** |
| 3. Fail-Closed Design | Good error-to-blocked mapping | Partial-failure state management for multi-step ops is undefined | **HIGH** |
| 4. Queue/Process Safety | Job deduplication exists | No maxConcurrency enforcement in-process; queue bypass route | **MEDIUM** |
| 5. Kill-Switch Integration | Three env-var gates checked | Stage 3 must add `POSITRON_ENABLE_MERGE` check | **LOW** |
| 6. Token Lifecycle | None (fake-only) | Entire lifecycle is human-manual; no automated enforcement | **HIGH** |
| 7. Attack Surface | Limited by fake-mode default | Real mode introduces adapter injection, race, replay risks | **MEDIUM** |
| 8. Redaction Pipeline | Regex covers 7 patterns | Fine-grained PAT regex needs verification; file content not redacted | **MEDIUM** |

---

## 1. Secret Handling

### 1.1 What Pattern Exists in Stage 2

Stage 2 uses a two-layer redaction approach:

**Layer 1: Hardcoded constant** (`stage2-write-sandbox-policy.ts`)

```typescript
// In Stage2PreWritePreview (line 95):
tokenValue: 'REDACTED';

// In Stage2WriteAuditEvent (line 111):
tokenValue: 'REDACTED';

// In createAuditEvent (line 370):
tokenValue: 'REDACTED';
```

**Layer 2: Regex-based redaction** (`packages/shared/src/utils.ts` lines 16-36)

```typescript
DEFAULT_REDACTION_RULES includes:
- github-token:     /ghp_[a-zA-Z0-9]{36}/g     → 'ghp_***REDACTED***'
- github-oauth-token: /gho_[a-zA-Z0-9_]{36}/g  → 'gho_***REDACTED***'
- github-app-token:   /ghb_[a-zA-Z0-9_]{36}/g  → 'ghb_***REDACTED***'
- github-token-v2:    /github_pat_[a-zA-Z0-9_]{82}/g → 'github_pat_***REDACTED***'
```

**Layer 3: Error message sanitization** (`stage2-runtime-write-harness.ts` lines 414-415)

```typescript
const rawMessage = error instanceof Error ? error.message : String(error ?? 'Unknown adapter error');
const sanitizedReason = redactValue(rawMessage);
```

The `redactValue` function (utils.ts lines 55-64) recursively applies `redactSecrets` to strings and JSON-serialized objects.

### 1.2 What Stage 3 Needs Additionally

1. **Fine-grained PAT regex verification**: The approval package specifies `github_pat_` prefix. The existing regex `/github_pat_[a-zA-Z0-9_]{82}/g` assumes exactly 82 characters after the prefix. GitHub fine-grained PATs use the format `github_pat_11A...` where the actual length varies. The regex must be tested against a real fine-grained PAT to verify coverage. **Gap: untested against the actual token format Stage 3 will use.**

2. **Token lifecycle enforcement**: Stage 2 has zero token lifecycle management because it's fake-only. Stage 3 must:
   - Read `POSITRON_STAGE3_GITHUB_TOKEN` from env via `SecretManager`
   - Verify the token is present before any write
   - Pass it to the injected adapter without logging it
   - Unset/clear from memory after the single write completes
   - **Cannot enforce revocation** (that is human-manual via GitHub UI, preflight P9 only checks it's not already set, not that it's been revoked)

3. **Audit event token field**: The hardcoded `tokenValue: 'REDACTED'` in Stage 2 is correct for audit events. Stage 3 should maintain this pattern — audit events must never contain real tokens. However, Stage 3 must add **token lifecycle audit events** (obtained, used, cleared) with timestamps.

4. **Error messages from Octokit**: The `mapRequestError` function in `real-adapter.ts` (lines 77-79) already calls `redactSecrets(err.message)` for GitHub 422 and unknown errors. This is good and should be inherited. But Stage 3's new operations (createBranch, createCommit, createPR) will produce new error types that must be passed through the same redaction pipeline.

### 1.3 Gaps and Concerns

| # | Gap | Severity | Stage 3 Mitigation |
|---|-----|----------|-------------------|
| G1 | `github_pat_` regex length assumption (82 chars) may miss tokens | **HIGH** | Test against actual fine-grained PAT before implementation |
| G2 | No automated token clearance from memory after write | **MEDIUM** | Overwrite env variable in process memory after write, add audit event |
| G3 | HTTPS/transport layer: token in Authorization header not covered by redaction rules | **LOW** | Octokit handles this; redaction only needed for log/audit output |
| G4 | Token could leak through `process.env` enumeration in debug endpoints | **MEDIUM** | No `/debug/env` endpoint exists; verify no new endpoints expose env |

### 1.4 Recommended Tests

- **REDACT-01**: Verify that `redactSecrets()` correctly masks a real fine-grained PAT (`github_pat_11A...`)
- **REDACT-02**: Verify that a PAT in error messages (e.g., 401 response body from GitHub) is caught by redaction rules
- **REDACT-03**: Verify that `Stage3WriteAuditEvent` has `tokenValue: 'REDACTED'` hardcoded, never dynamic
- **REDACT-04**: Verify that after the single write completes, the token variable is cleared from `process.env`
- **REDACT-05**: Verify that POSITRON_STAGE3_GITHUB_TOKEN does not appear in any audit JSONL output (`grep -r "github_pat_"` on audit files returns empty)

---

## 2. Allowlist Enforcement

### 2.1 What Pattern Exists in Stage 2

Stage 2's `Stage2WriteSandboxPolicy.validate()` enforces a 15+ gate chain (policy.ts lines 192-302):

1. Policy enabled
2. Permanently forbidden operations
3. Repository allowlist (exact string match)
4. Issue number allowlist (exact number match)
5. Operation allowlist (`allowedOperations` + `optionalAllowedOperations`)
6. Label allowlist (for `addIssueLabels`)
7. `maxWritesPerRun` counter
8. Human approval
9. Pre-write preview
10. Duplicate detection (idempotency key)
11. Kill-switch (POSITRON_ENABLE_PUSH, POSITRON_MERGE_KILL_SWITCH)

Additionally, the harness adds a body SHA-256 hash match check (harness.ts lines 209-233) outside the policy.

### 2.2 What Stage 3 Needs Additionally

The approval package specifies exact allowlist values for a **multi-step** operation:

| Step | Allowlist Value | Current Stage 2 Equivalent |
|------|----------------|---------------------------|
| Repository | `xxammaxx/positron-sandbox` | `allowedRepository` — ✅ exists |
| Branch name | `positron/issue-308-stage3-pilot` | Not in Stage 2 — must be new |
| File path | `stage3/positron-supervised-pilot.md` | Not in Stage 2 — must be new |
| File SHA-256 | `0a97795fdc21740548b4d02cc4b0dd0538afa0d2917390c84671a94b3089c823` — **HISTORICAL — SUPERSEDED by PR #370 integration (July 2026):** now `73ac6e0f...` | Body hash check exists but different scope |
| Commit message | Exact string | Not in Stage 2 |
| PR title | Exact string | Not in Stage 2 |
| PR body | Exact string | Not in Stage 2 |
| File count | Exactly 1 | MaxWritesPerRun covers count |
| Branch count | Exactly 1 | Must be new |
| PR count | Exactly 1 | Must be new |
| Merge | FORBIDDEN | PERMANENTLY_FORBIDDEN — ✅ |
| Draft PR | Required | Must be new |
| Production repo | FORBIDDEN | Repository allowlist covers this |

### 2.3 Hash-Binding Integrity Analysis

**Current Stage 2 hash-binding** (harness.ts lines 209-233):
- SHA-256 of `bodyText` computed at runtime
- Compared against `expectedBodyHash` from input
- Mismatch → blocked with hash values in audit event

**For Stage 3**, hash-binding should be extended to:
1. **File content SHA-256**: Must match exactly `0a97795fdc21740548b4d02cc4b0dd0538afa0d2917390c84671a94b3089c823` — **HISTORICAL — SUPERSEDED by PR #370 integration (July 2026):** now `73ac6e0faf0b13118de60a3a1eb02a54e68d272ecf137f356d134e84ea9f46ff`
2. **Commit message SHA-256**: Must match the exact commit message from the approval package
3. **PR title SHA-256**: Must match exact title
4. **PR body SHA-256**: Must match exact body

**SHA-256 collision risk assessment**: SHA-256 has a 256-bit output. Finding a collision requires ~2^128 operations (birthday attack) which is computationally infeasible with current technology. For the Stage 3 threat model (single supervised write, human approval), SHA-256 provides more than adequate integrity.

However, there's a subtle concern: **The approval package is a markdown file in the repository itself.** An attacker who can modify the approval package could change the expected SHA-256. This is mitigated by:
- The approval package is committed and versioned
- The baseline commit hash (`ea959dfb...`) is checked in preflight P3
- The human approval string contains the SHA-256

### 2.4 Gaps and Concerns

| # | Gap | Severity | Stage 3 Mitigation |
|---|-----|----------|-------------------|
| G5 | Stage 2 allows `optionalAllowedOperations` bypass if config is modified at runtime | **LOW** | Stage 3 should not have `optionalAllowedOperations` — all operations are deny-by-default |
| G6 | Branch name is not allowlisted against a policy field — it comes as a string parameter to the adapter | **MEDIUM** | Add `allowedBranchName` to Stage 3 policy config |
| G7 | PR title/body are not hash-bound in Stage 2 | **MEDIUM** | Add `expectedPrTitleHash` and `expectedPrBodyHash` to harness input |
| G8 | File count enforcement relies on `maxWritesPerRun=1` which counts operations, not files | **LOW** | If the "single operation" creates branch+commit+PR, `maxWritesPerRun` must count the whole transaction, not sub-steps |

### 2.5 Recommended Tests

- **ALLOW-01**: Verify branch name mismatch → ABORT (test with `positron/evil-branch`)
- **ALLOW-02**: Verify file path mismatch → ABORT (test with `.github/workflows/malicious.yml`)
- **ALLOW-03**: Verify SHA-256 mismatch → ABORT (test with modified file content)
- **ALLOW-04**: Verify commit message mismatch → ABORT (test with different message)
- **ALLOW-05**: Verify PR title mismatch → ABORT
- **ALLOW-06**: Verify PR body mismatch → ABORT
- **ALLOW-07**: Verify production repo `Mueller-Systems-Lab/Positron` → ABORT
- **ALLOW-08**: Verify merge attempt → ABORT (POSITRON_MERGE_KILL_SWITCH=true)
- **ALLOW-09**: Verify second file attempt → ABORT
- **ALLOW-10**: Verify executable file attempt → ABORT

---

## 3. Fail-Closed Design

### 3.1 What Pattern Exists in Stage 2

Stage 2 implements fail-closed at two levels:

**Policy level** (stage2-write-sandbox-policy.ts):
- Default config blocks everything: `enabled: false`, `maxWritesPerRun: 0`, `allowedOperations: []`
- 15+ gate chain — failure at any gate returns `{ allowed: false, reason: ... }`

**Harness level** (stage2-runtime-write-harness.ts lines 409-439):
```typescript
catch (error: unknown) {
    // Adapter error: do NOT increment write count, do NOT leak raw error
    // Record idempotency key (no counter increment) to prevent infinite retries
    this.policy.recordIdempotencyKey(input.idempotencyKey);
    // ... return blocked
}
```

Key pattern: **Adapter failure → idempotency key recorded (without write count increment) → blocked**. This prevents infinite retry loops while also preventing the system from claiming a successful write.

### 3.2 Stage 3 Partial Failure Scenarios

Stage 3 is multi-step (branch → commit → PR). Each sub-step can fail independently:

| Scenario | Detection | Required Response |
|----------|-----------|-------------------|
| **S1: Branch created, commit fails** | GitHub API error on commit/PUT call | ABORT. Do NOT retry. Record the residual branch for manual cleanup. Revoke token. |
| **S2: Branch + commit created, PR fails** | GitHub API error on PR creation | ABORT. Do NOT retry. The branch/commit exist on GitHub — this is acceptable (draft state). Report the branch for cleanup. |
| **S3: Process crash at any step** | No audit trail entry for completion | ABORT on restart. Preflight P5-P8 check env vars. Manual cleanup of any residual state. |
| **S4: Network timeout during write** | RequestError with network code | ABORT. Record idempotency key (no counter increment). Check if write actually landed via read-only API before deciding to retry. |
| **S5: Token expired mid-operation** | 401 from GitHub API | ABORT. Token lifecycle audit event. No retry with same token. |

### 3.3 Preventing "Second Write" on Retry

Stage 2's mechanism: idempotency key recorded via `recordIdempotencyKey()` even on failure. This prevents the same key from being reused.

**For Stage 3**, this must be extended:
1. **Transaction-level idempotency key**: A single key that covers all three sub-steps (branch, commit, PR). If any sub-step fails, the entire key is consumed.
2. **Pre-write read check**: Before creating the branch, check via read-only API whether the branch already exists on the sandbox repository. If yes, the write already happened (idempotent detection).
3. **PR existence check**: The `real-adapter.ts` `createPullRequest` method (lines 281-343) already checks for an existing PR before creating one. Stage 3 should use this pattern.
4. **No automatic retry**: Stage 3 must NOT implement automatic retry loops. Any failure → manual cleanup → new approval cycle.

### 3.4 Gaps and Concerns

| # | Gap | Severity | Stage 3 Mitigation |
|---|-----|----------|-------------------|
| G9 | No transaction rollback mechanism — branch/commit can't be "uncreated" | **HIGH** | Document that residual state requires manual cleanup; do NOT attempt automatic deletion |
| G10 | idempotency key consumed on failure prevents legitimate retry after manual cleanup | **MEDIUM** | Document that retry requires new idempotency key and new approval |
| G11 | Process crash could leave idempotency key unrecorded | **MEDIUM** | Write idempotency key to persistent storage BEFORE starting the write, not after |
| G12 | No timeout for the total multi-step operation | **LOW** | Add overall timeout (e.g., 30 seconds) for the complete branch→commit→PR sequence |

### 3.5 Recommended Tests

- **FAIL-01**: Simulate branch creation success + commit failure → verify ABORT, idempotency key consumed, no retry
- **FAIL-02**: Simulate branch + commit success + PR failure → verify ABORT, residual state documented
- **FAIL-03**: Simulate process crash after branch creation → verify on restart the idempotency key is recognized and does NOT create a second branch
- **FAIL-04**: Simulate 401 token error → verify ABORT, no retry, token lifecycle audit
- **FAIL-05**: Simulate network timeout → verify idempotency key consumed, read-only verification before any decision to retry
- **FAIL-06**: Verify that `maxWritesPerRun=1` prevents a second complete transaction even with a different idempotency key

---

## 4. Queue/Process Safety

### 4.1 What Pattern Exists in Stage 2

**BullMQ configuration** (`apps/server/src/index.ts`):

- Queue name: `positron-pipeline` (constant from `@positron/shared`)
- Job deduplication via `jobId: run.id` (line 2901)
- `POSITRON_DISABLE_QUEUE=true` bypasses queue entirely (line 2875-2879)
- Inline fallback when Redis/workers unavailable (lines 2919-2938)
- `Queue.getWorkers()` check before enqueuing (line 2895-2898)
- Job data type: `PipelineJobData { runId, repoId, issueNumber, autonomyLevel }`

**Metrics collection** (lines 2476-2526):
- `queueJobsWaiting`, `queueJobsActive`, `queueJobsCompletedTotal`, `queueJobsFailedTotal`
- `queueWorkerUp` with optional suppression via `POSITRON_ALERT_WORKER_DOWN_ENABLED`

### 4.2 What Stage 3 Needs

The approval package preflight P8 requires: `POSITRON_DISABLE_QUEUE=true`

This means Stage 3 **must NOT use BullMQ at all**. It runs as an inline, single-process operation. The approval package also requires `maxConcurrency=1` — but there's **no programmatic concurrency enforcement** in the current codebase. The `queueJobsActive` gauge observes concurrency but doesn't limit it.

**Required Stage 3 checks:**
1. `POSITRON_DISABLE_QUEUE=true` must be verified in preflight — if false or unset, ABORT
2. Process-level concurrency guard: Before executing, check that no other Stage 3 operation is running (simple in-process flag or file lock)
3. No worker process must be running (verify via health check or process enumeration)

### 4.3 Gaps and Concerns

| # | Gap | Severity | Stage 3 Mitigation |
|---|-----|----------|-------------------|
| G13 | `POSITRON_DISABLE_QUEUE` can be set but worker still running → two concurrent writes | **HIGH** | Add explicit worker health check: if `getWorkers().length > 0`, do not proceed even with DISABLE_QUEUE=true |
| G14 | No in-process mutex/lock to prevent multiple inline pipeline runs | **MEDIUM** | Add simple boolean `stage3Locked` flag set at start, cleared at end or on crash |
| G15 | Inline fallback in server (line 2823-2850) fires pipeline asynchronously without await → response sent before pipeline completes | **HIGH** | Stage 3 must use the `POST /api/repos/:repoId/runs` path (line 2865) which awaits the pipeline |
| G16 | `jobId: run.id` deduplication only works within BullMQ — not for inline runs | **LOW** | Inline runs need their own deduplication check (persisted to DB) |

### 4.4 Recommended Tests

- **QUEUE-01**: Verify that `POSITRON_DISABLE_QUEUE !== 'true'` → ABORT with clear reason
- **QUEUE-02**: Verify that concurrent inline runs are blocked (second request receives 409 Conflict or similar)
- **QUEUE-03**: Verify that an existing worker process causes ABORT even when DISABLE_QUEUE=true
- **QUEUE-04**: Verify that after successful Stage 3 completion, the in-process lock is released
- **QUEUE-05**: Verify that after Stage 3 failure/crash, the lock is released (via process exit or timeout)

---

## 5. Kill-Switch Integration

### 5.1 What Pattern Exists in Stage 2

Three kill-switches are checked:

**In the policy** (stage2-write-sandbox-policy.ts lines 280-299):
```typescript
if (this.config.requireKillSwitchActive) {
    // Conceptual check — delegate to caller
}
if (this.config.requirePushDisabled && pushEnabled) {
    return { allowed: false, reason: 'POSITRON_ENABLE_PUSH is true...' };
}
if (this.config.requireMergeKillSwitchActive && !mergeKillSwitchActive) {
    return { allowed: false, reason: 'POSITRON_MERGE_KILL_SWITCH is false...' };
}
```

**In the harness** (stage2-runtime-write-harness.ts lines 279-280):
```typescript
pushEnabled: input.pushEnabled ?? false,
mergeKillSwitchActive: input.mergeKillSwitchActive ?? true,
```

Note the defaults: `pushEnabled` defaults to `false` (safe — blocks push), `mergeKillSwitchActive` defaults to `true` (safe — blocks merge).

**In the server** (apps/server/src/index.ts lines 1087, 1293-1295):
```typescript
const pushAllowed = process.env.POSITRON_ENABLE_PUSH === 'true';
const mergeAllowed = process.env.POSITRON_ENABLE_MERGE === 'true';
const mergeKillSwitch = process.env.POSITRON_MERGE_KILL_SWITCH !== 'false';
```

### 5.2 What Stage 3 Needs

The approval package preflight requires:

| Check | Required Value | Current Env Var | Stage 3 Integration |
|-------|---------------|-----------------|-------------------|
| P5 | `POSITRON_MERGE_KILL_SWITCH=true` | `POSITRON_MERGE_KILL_SWITCH !== 'false'` — already defaults to true | ✅ Inherit from Stage 2 |
| P6 | `POSITRON_ENABLE_PUSH=false` | `POSITRON_ENABLE_PUSH === 'true'` → false by default | ✅ Inherit from Stage 2 |
| P7 | `POSITRON_ENABLE_MERGE=false` | `POSITRON_ENABLE_MERGE === 'true'` → false by default | Must be explicitly verified in Stage 3 |

**Additional Stage 3 requirement**: Stage 3 must check that `POSITRON_ENABLE_MERGE=false` in the policy. Stage 2 has `requirePushDisabled` and `requireMergeKillSwitchActive` in the policy config but no equivalent `requireMergeDisabled`. Stage 3 should add this.

### 5.3 Gaps and Concerns

| # | Gap | Severity | Stage 3 Mitigation |
|---|-----|----------|-------------------|
| G17 | `requireMergeKillSwitchActive` only checks the kill-switch, not `POSITRON_ENABLE_MERGE` | **MEDIUM** | Add `requireMergeDisabled` to Stage 3 policy config |
| G18 | Kill-switch defaults in harness assume safe values (`pushEnabled ?? false`, `mergeKillSwitchActive ?? true`) — a caller could override these | **LOW** | Stage 3 harness should read env vars directly, not accept them as parameters |

### 5.4 Recommended Tests

- **KILL-01**: Verify that `POSITRON_MERGE_KILL_SWITCH=false` → ABORT (kill-switch is inverted logic)
- **KILL-02**: Verify that `POSITRON_ENABLE_PUSH=true` → ABORT
- **KILL-03**: Verify that `POSITRON_ENABLE_MERGE=true` → ABORT (new for Stage 3)
- **KILL-04**: Verify that all three must be in the correct state simultaneously

---

## 6. Token Lifecycle

### 6.1 What Pattern Exists in Stage 2

**None.** Stage 2 is fake-only and never touches a real GitHub token. The `Stage2RuntimeWriteHarness` receives an injected `Stage2IssueCommentWriter` adapter — the harness itself has no concept of tokens.

The `SecretManager` (shared/src/secret-manager.ts) provides infrastructure for secret resolution but is not used by the Stage 2 harness.

### 6.2 Token Lifecycle from Approval Package

The approval package defines a 7-step manual-human lifecycle:

| Step | Action | Actor | What Stage 3 Must Enforce |
|------|--------|-------|--------------------------|
| 1 | Create fine-grained PAT in GitHub UI | Owner (human) | Cannot enforce — preflight P9 checks it's not yet set |
| 2 | Export `POSITRON_STAGE3_GITHUB_TOKEN=github_pat_...` | Owner (human) | Cannot enforce — read from env at start |
| 3 | Run Stage 3 execution prompt | Orchestrator | **Verify token present, use exactly once** |
| 4 | Verify PR exists on sandbox | Orchestrator (read-only) | **Read-only API call with DIFFERENT token or unauthenticated** |
| 5 | `unset POSITRON_STAGE3_GITHUB_TOKEN` | Owner (human) | **Clear from process.env after write, audit the clearing** |
| 6 | Revoke PAT in GitHub UI | Owner (human) | **Cannot enforce — document in post-write verification** |
| 7 | Verify token no longer exists | Orchestrator (read-only) | **Attempt a write with the token, expect 401 — log result** |

### 6.3 Assurances Stage 3 Must Provide

1. **Single-use enforcement**: After the write transaction completes (success or failure), the harness must:
   - Immediately clear `process.env.POSITRON_STAGE3_GITHUB_TOKEN` (set to empty string or delete)
   - Set an in-memory flag `tokenConsumed = true` to prevent reuse within the same process
   - Log a `token_lifecycle: consumed` audit event

2. **No token persistence**: The token must not be:
   - Written to any file (audit JSONL, logs, DB)
   - Included in any HTTP response
   - Passed to any external service except GitHub API via Octokit
   - Stored in any cache or session

3. **Token scoping validation**: Before use, the harness should verify token scope via GitHub API `/user` or `/rate_limit` endpoint (which returns scopes in headers) to confirm it only has access to `xxammaxx/positron-sandbox`.

4. **Post-write token verification**: After clearing the token from env, the harness should confirm it's gone by reading `process.env.POSITRON_STAGE3_GITHUB_TOKEN` and asserting it's undefined/empty.

### 6.4 Gaps and Concerns

| # | Gap | Severity | Stage 3 Mitigation |
|---|-----|----------|-------------------|
| G19 | No automated token scope validation before write | **MEDIUM** | Call GitHub API with the token before write to verify scopes via `X-OAuth-Scopes` header |
| G20 | Token could be captured in Node.js heap dump or core dump | **LOW** | Document that heap dumps must be disabled in production; set `--heapsnapshot-near-heap-limit=0` |
| G21 | Token clearing from env doesn't prevent reuse if someone saved it before clearing | **LOW** | Human-manual revocation (step 6) is the ultimate security boundary |
| G22 | Preflight P9 checks token is NOT already set — but if someone sets it during execution, there's no detection | **LOW** | Stage 3 is single-process, short-lived (~5 seconds). Race window is minimal. |

### 6.5 Recommended Tests

- **TOKEN-01**: Verify that after write completion, `POSITRON_STAGE3_GITHUB_TOKEN` is cleared from `process.env`
- **TOKEN-02**: Verify that a second write attempt with the same harness instance is blocked (token consumed flag)
- **TOKEN-03**: Verify that the token does not appear in any audit event, log line, or DB record
- **TOKEN-04**: Verify that `grep "github_pat_"` on all output files (audit JSONL, server logs) returns empty
- **TOKEN-05**: Verify that Octokit authentication error (401) is handled without leaking the token in the error message

---

## 7. Attack Surface

### 7.1 Attack Vector Analysis

#### 7.1.1 Second Run with Same/Duplicate Token

**Risk**: Owner creates the token, Stage 3 uses it, but the token is not immediately revoked. Someone re-runs Stage 3 before revocation.

**Mitigation in Stage 3**:
- In-process `tokenConsumed` flag prevents reuse within the same process
- If running as a separate process, the idempotency key (persisted before write) prevents duplicate execution
- **Residual risk**: A determined attacker who restarts the process from scratch (without persistent idempotency state) could reuse the token. Mitigated by token expiry (7 days) and human revocation (step 6).

#### 7.1.2 Token Leakage Through Errors/Logs/Audit

**Risk**: GitHub API errors may include the token in response bodies or headers. Node.js errors may include the token in stack traces.

**Stage 2 mitigation** (inherits to Stage 3):
- `redactSecrets()` applied to all error messages in `mapRequestError()` (real-adapter.ts lines 77-79)
- `redactValue()` applied to all adapter errors in harness (harness.ts line 415)
- Audit events never include raw API output
- `tokenValue: 'REDACTED'` hardcoded

**Stage 3 additional concerns**:
- Octokit uses the token in `Authorization: Bearer <token>` header — if Octokit's error handling includes request headers in error messages, this could leak
- Stack traces: if an unhandled exception includes the token (e.g., from constructing the Octokit client), it would appear in server logs
- **Mitigation**: Test with a real fine-grained PAT and verify no leaks in error paths

#### 7.1.3 Hash Collision in SHA-256 Content Verification

**Risk**: An attacker creates a different file that hashes to the same SHA-256 as the approved file.

**Assessment**: SHA-256 preimage resistance is 2^256, collision resistance is 2^128. For the Stage 3 threat model:
- Preimage attack (find ANY input with hash `0a97795f...` — **HISTORICAL — SUPERSEDED by PR #370 integration (July 2026):** now `73ac6e0f...`): ~2^256 operations — infeasible
- Collision attack (find TWO different inputs with the same hash): ~2^128 operations — infeasible

**Residual risk**: Extremely low. SHA-256 provides more than adequate integrity for this use case.

#### 7.1.4 Bypass Through Adapter Injection

**Risk**: The harness uses dependency injection via the `Stage2IssueCommentWriter` interface. If a malicious adapter is injected instead of the real adapter, policy gates could be bypassed.

**Stage 2 mitigation**: The adapter is created by the server (`createApp()`) and injected into the harness at construction time. The harness never creates its own adapter.

**Stage 3 concern**: The Stage 3 harness will need a new interface (e.g., `Stage3WriteAdapter`) that exposes branch creation, file writing, commit, and PR creation. The adapter injection pattern is sound, but:
- **The adapter itself** (`RealGitHubAdapter`) has no policy gates — it directly calls Octokit
- The harness is the ONLY gatekeeper
- If the harness is bypassed and the adapter is called directly, all policy gates are skipped

**Mitigation**: The Stage 3 adapter interface should be deliberately incomplete/narrow — it should NOT expose `mergePullRequest`, `closeIssue`, or any write method beyond what Stage 3 needs. Even better: create a `Stage3ScopedAdapter` wrapper that internally calls `RealGitHubAdapter` methods but refuses any method not in the Stage 3 allowlist.

#### 7.1.5 Race Conditions in Fake/Live Mode Check

**Risk**: The harness checks `this.config.fakeMode` at execution time (harness.ts line 308). If `fakeMode` is changed between the check and the actual write, a write could execute in what was supposed to be fake mode.

**Assessment**: In Stage 2, `fakeMode` is a constructor parameter and is not mutated. In Stage 3:
- `fakeMode` must default to `true`
- `fakeMode = false` must only be settable via explicit environment variable (`POSITRON_STAGE3_REAL_MODE=true`)
- The `fakeMode` flag should be read once at initialization and cached — not re-read during execution
- **No race condition exists** in the current single-threaded Node.js event loop, but concurrent requests via the Express server could be a concern

#### 7.1.6 Adapter Method Exposure

**Risk**: `RealGitHubAdapter` implements the full `GitHubAdapter` interface with all write methods (`mergePullRequest`, `closeIssue`, `requestReviewers`, etc.). If the Stage 3 harness receives the full adapter (not a narrow interface), any code in the harness could call forbidden methods.

**Stage 2 mitigation**: The harness defines a narrow `Stage2IssueCommentWriter` interface with only `createIssueComment`. The full adapter is not passed to the harness.

**Stage 3 requirement**: The Stage 3 harness must define a similarly narrow interface (e.g., `Stage3WriteAdapter`) that exposes only: `createBranch`, `createOrUpdateFile`, `createCommit`, `createPullRequest`. No merge, close, or label methods.

### 7.2 Attack Surface Summary

| # | Attack Vector | Risk | Confidence in Mitigation |
|---|--------------|------|------------------------|
| A1 | Second run with same token | MEDIUM | Partial — depends on persistent idempotency + human revocation |
| A2 | Token leakage through errors | MEDIUM | Good — redaction pipeline covers known patterns |
| A3 | SHA-256 hash collision | VERY LOW | SHA-256 is sufficient for this threat model |
| A4 | Adapter injection bypass | MEDIUM | Good — narrow interface pattern from Stage 2 |
| A5 | Fake/live mode race | LOW | Single-threaded Node.js inherently sequential |
| A6 | Full adapter method exposure | MEDIUM | Good — narrow interface pattern; must ensure it's used |
| A7 | Branch creation with shell injection in name | LOW | Branch name is from approval package constant, not user input |

### 7.3 Recommended Red-Team Tests

- **RED-01**: Attempt to call `github.mergePullRequest()` through the Stage 3 adapter interface (should be impossible due to narrow interface)
- **RED-02**: Pass a token containing `github_pat_` in an error message body and verify `redactSecrets` catches it
- **RED-03**: Attempt to reuse an idempotency key after a successful Stage 3 write → expect ABORT
- **RED-04**: Attempt to create a branch with a name not matching the allowlisted value → expect ABORT
- **RED-05**: Send two concurrent Stage 3 requests and verify one is rejected
- **RED-06**: Attempt to write to `Mueller-Systems-Lab/Positron` → expect ABORT
- **RED-07**: Pass a modified PR body that hashes to the same SHA-256 (theoretically impossible for SHA-256, but test the hash comparison logic)

---

## 8. Redaction Pipeline

### 8.1 What Pattern Exists in Stage 2

**`redactSecrets()`** (utils.ts lines 42-49):
- Pattern-based regex replacement
- 7 default rules covering: ghp_, gho_, ghb_, github_pat_, sk-, anthropic_, AIza
- Rules are readonly const array, not modifiable at runtime

**`redactValue()`** (utils.ts lines 55-64):
- Wraps `redactSecrets` for unknown input types
- Handles null, undefined, strings, numbers, booleans, and JSON objects
- Falls back to `'[Unserializable]'` for non-serializable values

**Usage in Stage 2**:
1. `stage2-write-sandbox-policy.ts` line 356: `sanitizedReason = redactValue(params.reason)` — used in `createAuditEvent`
2. `stage2-runtime-write-harness.ts` line 415: `const sanitizedReason = redactValue(rawMessage)` — used in adapter error handling
3. `real-adapter.ts` lines 77, 79: `redactSecrets(err.message)` — used in GitHub API error mapping
4. `sync-service.ts` lines 84, 135, etc.: `redactSecrets(String(err))` — used in sync event error handling

**Hardcoded redaction in Stage 2**:
- `tokenValue: 'REDACTED'` in `Stage2PreWritePreview` (line 95), `Stage2WriteAuditEvent` (line 111), and `createAuditEvent` return (line 370)
- `tokenValue: 'REDACTED'` in `generatePreview` return (line 335)

### 8.2 What Stage 3 Must Redact

| Data | Redaction Method | Rationale |
|------|-----------------|-----------|
| POSITRON_STAGE3_GITHUB_TOKEN | Hardcoded `'REDACTED'` in audit/preview types | Same pattern as Stage 2 |
| GitHub API error messages | `redactValue(error.message)` in catch blocks | Inherited from Stage 2 harness pattern |
| File content (stage3/positron-supervised-pilot.md) | Never logged in full — only hash and length | Avoids leaking the marker file content |
| HTTP Authorization headers | Never captured in audit/log output | Octokit handles transport; audit never sees headers |
| Stack traces from unhandled exceptions | `redactValue(String(error))` in top-level catch | Must cover any unhandled paths |
| Octokit client initialization error | `redactValue()` on error before logging | If token is malformed, Octokit may include it in error |
| PR URL on sandbox | Not redacted — this is a public-facing URL | The PR URL is evidence, not a secret |

### 8.3 Redaction Coverage Gaps

| # | Gap | Current State | Stage 3 Requirement |
|---|-----|--------------|-------------------|
| G23 | Fine-grained PAT regex (`/github_pat_[a-zA-Z0-9_]{82}/g`) assumes exactly 82 chars | Untested against actual PAT format | Test with real PAT, adjust regex if needed |
| G24 | No redaction of `process.env` in debug/log output | No debug endpoint exists | Ensure no new debug endpoints expose env |
| G25 | File content is never redacted in Stage 2 (not needed — no file writes) | N/A | Stage 3 must log only `fileHash` and `fileLength`, never `fileContent` |
| G26 | Commit SHA is logged unredacted | Commit SHA is not a secret | Correct — commit SHAs are public |
| G27 | The token itself is never passed to `redactValue` — it's not in scope | The token goes from env → Octokit, never through redaction | Add explicit `redactSecrets()` call on any string that might transitively contain the token |

### 8.4 Recommended Tests

- **PIPE-01**: Verify that a real fine-grained PAT in any log line is caught by default redaction rules
- **PIPE-02**: Verify that `Stage3WriteAuditEvent` never contains `github_pat_` (grep audit output)
- **PIPE-03**: Verify that file content is not included in any audit event, error message, or log line
- **PIPE-04**: Verify that `redactValue()` correctly handles an object containing a PAT (e.g., `{ token: 'github_pat_11A...' }`)
- **PIPE-05**: Verify that Octokit's `RequestError` (e.g., 401 with `Bad credentials`) does not leak the token
- **PIPE-06**: Verify that all new Stage 3 error paths call `redactValue()` before logging/auditing

---

## Consolidated Test Plan for Stage 3

### Negative Tests (Red Team)

| # | Test | Category | Priority |
|---|------|----------|----------|
| T1 | Token in error message → must be redacted in audit | Secret Handling | P0 |
| T2 | Token in process.env after write → must be cleared | Token Lifecycle | P0 |
| T3 | Second run with same idempotency key → ABORT | Fail-Closed | P0 |
| T4 | Write to production repo `Mueller-Systems-Lab/Positron` → ABORT | Allowlist | P0 |
| T5 | SHA-256 mismatch on file content → ABORT | Allowlist | P0 |
| T6 | PR title mismatch → ABORT | Allowlist | P0 |
| T7 | `POSITRON_MERGE_KILL_SWITCH=false` → ABORT | Kill-Switch | P0 |
| T8 | `POSITRON_ENABLE_PUSH=true` → ABORT | Kill-Switch | P0 |
| T9 | `POSITRON_DISABLE_QUEUE !== true` → ABORT | Queue Safety | P0 |
| T10 | Branch name not `positron/issue-308-stage3-pilot` → ABORT | Allowlist | P1 |
| T11 | Second file creation attempt → ABORT | Allowlist | P1 |
| T12 | Attempt to merge via adapter → method not available | Attack Surface | P1 |
| T13 | Concurrent Stage 3 requests → one rejected | Queue Safety | P1 |
| T14 | Process crash mid-write → idempotency prevents retry | Fail-Closed | P1 |
| T15 | Token with wrong scopes → detected before write | Token Lifecycle | P2 |
| T16 | Executable file creation attempt → ABORT | Allowlist | P2 |
| T17 | `.github/workflows/` path attempt → ABORT | Allowlist | P2 |
| T18 | `redactSecrets` on real fine-grained PAT → verified | Redaction | P2 |

### Positive Tests (Happy Path)

| # | Test | Category |
|---|------|----------|
| T19 | Full Stage 3 flow in fake mode → all gates pass, no write | Integration |
| T20 | Full Stage 3 flow in real mode (with real PAT) → PR created on sandbox | Integration |
| T21 | Post-write verification: all 10 V-checks pass | Verification |
| T22 | Token lifecycle audit events complete and correct | Audit |
| T23 | All 15 preflight checks recorded before write | Preflight |

---

## Summary of Architectural Gaps Requiring Stage 3 Implementation Attention

1. **No persistent idempotency store**: Stage 2's idempotency is in-memory only. Stage 3's multi-step operation needs persistent idempotency to survive process crashes. **Recommendation**: Write idempotency key to SQLite BEFORE starting any GitHub API call.

2. **No multi-step transaction model**: Stage 2 is a single write (createIssueComment). Stage 3 is three steps (branch, commit, PR) with no rollback. **Recommendation**: Implement as a saga pattern with compensation — but compensation is "document and abort", not automatic cleanup.

3. **No concurrency guard for inline mode**: `POSITRON_DISABLE_QUEUE=true` bypasses BullMQ's built-in rate limiting. **Recommendation**: Add an in-process mutex (boolean flag or file lock in `.positron/stage3.lock`).

4. **No adapter scope enforcement**: The `RealGitHubAdapter` exposes all write methods. Stage 3's harness receives only the narrow interface, but if the adapter itself is passed elsewhere, all methods are available. **Recommendation**: Create a `Stage3ScopedWriteAdapter` wrapper that only exposes the three required operations and throws on any other method.

5. **Token clearing is not atomic with write completion**: If the process crashes between `adapter.createPullRequest()` and `process.env.POSITRON_STAGE3_GITHUB_TOKEN = ''`, the token remains in env. **Recommendation**: Clear the token in a `finally` block, not after success.

---

## CVSS Assessment (Preliminary)

**If Stage 3 were to be exploited** (token leak to attacker with sandbox repo access):

| Metric | Value | Justification |
|--------|-------|---------------|
| AV (Attack Vector) | Network (N) | Token could be exfiltrated over network |
| AC (Attack Complexity) | High (H) | Requires token theft + specific knowledge of sandbox |
| PR (Privileges Required) | None (N) | Attacker with stolen token needs no prior auth |
| UI (User Interaction) | None (N) | Automated exploitation possible |
| S (Scope) | Changed (C) | Sandbox repo is separate from production |
| C (Confidentiality) | Low (L) | Sandbox repo only, no production access |
| I (Integrity) | Low (L) | Can write to sandbox only |
| A (Availability) | None (N) | No DoS vector |

**CVSS 3.1 Vector**: `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:C/C:L/I:L/A:N`  
**Score**: 5.4 (Medium)

This assessment assumes the token is scoped ONLY to the sandbox repository and has no production access. If the token had broader scopes, impact would increase significantly.

---

**Document Status**: Complete — 8 areas reviewed, 23 gaps identified, 23 tests recommended.  
**Next Step**: Present to human owner for review before any Stage 3 implementation begins.  
**PR #370 Integration (July 2026):** This review was pre-implementation. All 23 gaps were addressed during implementation of the five remediation modules (approval-binding, base-resolver, safety-probe, reader-verifier, bridge). Integration is now complete. See `docs/adr/ADR-stage3-remediation-design.md` and `docs/evidence/issue-308/stage3-runtime-foundation-test-matrix.md` for current test coverage (345 tests, 10 files, 100% pass).
