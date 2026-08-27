# GitHub Stage 2 Write-Sandbox Token Policy

## Purpose

Defines the least-privilege token requirements for the Positron Stage 2 Write Sandbox test. This policy covers ONLY the first controlled write operation (createIssueComment on a dedicated sandbox target).

## Status

**PREFLIGHT — Dry-run preflight completed 2026-07-10. Token scope defined, NOT created.** This document defines the policy for the upcoming Stage-2 dry run. No write token has been created or used at any point. The dry-run preflight (PR TBD) verified sandbox target, generated pre-write preview, and defined the exact token scope below.

### Key Preflight Values (from dry-run preflight)

| Field | Value |
|---|---|
| Comment body SHA-256 | `48be36a2eccb9dc4a1e90c336cbec0045a13e44048d56dfcac83da5d228f371e` |
| Comment body length | 215 bytes |
| Idempotency key | `e2cab0b797a942a0` |

These values are embedded in the later Human Approval string to prevent body tampering and replay.

## Token Requirements for Stage 2

### Token Type

Fine-grained GitHub Personal Access Token (github_pat_...)

### Required Permissions

| Permission | Level | Purpose |
|---|---|---|
| Metadata | Read-only | Repository metadata (always granted) |
| Issues | Read and write | Required for createIssueComment on sandbox issue |

### Explicitly Denied Permissions

- **No** Contents access (no code push)
- **No** Pull requests access (no PR creation/merge)
- **No** Administration access
- **No** Workflow access
- **No** Webhook access
- **No** Deployment access
- **No** Secrets access
- **No** Organization access

### Repository Scope

The token MUST be scoped to a single sandbox repository:
- **Selected:** `xxammaxx/positron-sandbox` (dedicated, private, no production data)
- **Verified:** 2026-07-10 dry-run preflight — repo exists, issue #1 open, label `positron-stage2-sandbox` present
- **Alternative:** NONE — only `xxammaxx/positron-sandbox` is permitted for Stage 2

The token MUST NOT have access to any other repositories, especially NOT `Mueller-Systems-Lab/Positron`.

### Token Expiry

- Maximum 7 days (GitHub's shortest fine-grained token expiry)
- Immediate revocation after the Stage 2 test

## Operational Rules

### Token Lifecycle (for later execution — NOT this run)

1. **Creation:** Token created manually by Owner through GitHub UI → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. **Repository access:** Only selected repositories → `xxammaxx/positron-sandbox` (or approved target)
3. **Permissions:** Only Metadata (read) + Issues (read/write) as defined above
4. **Setting:** Token set ONLY in local shell: `export POSITRON_STAGE2_GITHUB_TOKEN=github_pat_...`
5. **Usage:** Token used for exactly ONE write operation during Stage 2 test
6. **Unset:** `unset POSITRON_STAGE2_GITHUB_TOKEN` immediately after test
7. **Revocation:** Token revoked through GitHub UI immediately after test
8. **No persistence:** Token NEVER stored in .env, NEVER committed, NEVER saved to file

### Security Boundaries

| Rule | Description |
|---|---|
| No `.env` storage | Token must never appear in any `.env` file |
| No logging | Token must never appear in logs, errors, or audit events |
| No screenshots | Token must never appear in evidence screenshots |
| No test output | Token must never appear in test output |
| No commit | Token must never be committed to git |
| Owner-only | Token handled ONLY by human Owner; Positron never manages token lifecycle |
| Separate from Stage 1 token | Different env var name: `POSITRON_STAGE2_GITHUB_TOKEN` (not `GITHUB_TOKEN`) |
| Separate from Stage 1 token scope | Write-scoped, not read-only |

### Redaction Rules (unchanged from Stage 1)

The following patterns must be redacted from all Positron output:

- `ghp_[A-Za-z0-9]{36}` → `ghp_***REDACTED***`
- `github_pat_[A-Za-z0-9_]{82}` → `github_pat_***REDACTED***`
- `GITHUB_TOKEN=...` → `GITHUB_TOKEN=***-redacted-***`
- `Authorization: Bearer ...` → `Authorization: Bearer ***-redacted-***`
- `X-Admin-Token: ...` → `X-Admin-Token: ***-redacted-***`

Redaction helpers in:
- `packages/shared/src/utils.ts` — `redactValue()`
- `packages/shared/src/secret-manager.ts` — `SecretManager`
- `apps/server/src/sse/broadcaster.ts` — SSE redaction
- `apps/web/src/voice/redact-for-speech.ts` — Voice redaction

## Pre-Flight Checks (Before Stage-2 Execution)

Before executing the Stage-2 write sandbox test, verify:

- [ ] Token is fine-grained with Issues read/write ONLY
- [ ] Token has access ONLY to sandbox repository (not production repo)
- [ ] Token is NOT hardcoded in any file
- [ ] Token is set as `POSITRON_STAGE2_GITHUB_TOKEN` (separate from Stage 1 token)
- [ ] `POSITRON_GITHUB_MODE=real` is NOT set (kept at default)
- [ ] `POSITRON_ENABLE_PUSH=true` is NOT set
- [ ] `POSITRON_MERGE_KILL_SWITCH=false` is NOT set
- [ ] `POSITRON_ENABLE_MERGE=true` is NOT set
- [ ] No `.env` file in workspace root
- [ ] Audit sink is configured and writable
- [ ] Redaction pipeline is active
- [ ] Sandbox target repository exists
- [ ] Sandbox target issue exists with label `positron-stage2-sandbox`
- [ ] MaxWritesPerRun = 1 configured
- [ ] Human approval prompt configured

## Post-Run Cleanup

After the Stage-2 test:

- [ ] `unset POSITRON_STAGE2_GITHUB_TOKEN`
- [ ] Revoke token through GitHub UI
- [ ] Verify no token in logs: `grep -r "ghp_\|github_pat_" .opencode/logs/ --exclude-dir=node_modules`
- [ ] Archive audit log
- [ ] Document test results in Issue #308
- [ ] If sandbox repo was used: delete or archive sandbox repo (optional)

## Differences from Stage 1 Token Policy

| Aspect | Stage 1 (ReadOnly) | Stage 2 (Write Sandbox) |
|---|---|---|
| Token env var | `GITHUB_TOKEN` | `POSITRON_STAGE2_GITHUB_TOKEN` |
| Issues permission | Read-only | Read and write |
| Contents permission | Read-only | No access |
| Pull requests permission | Read-only | No access |
| Repository scope | Mueller-Systems-Lab/Positron | xxammaxx/positron-sandbox (recommended) |
| Max operations | Unlimited reads | Exactly 1 write |
| Human approval | Not required | Required before each write |
| Dry-run preview | Not required | Required before each write |

## References

- Stage 2 Blueprint: `docs/evidence/stage2-write-sandbox-blueprint.md`
- Stage 1 Token Policy: `docs/security/github-readonly-token-policy.md`
- Stage 1 Evidence: `docs/evidence/stage1-readonly-dry-run.md`
- Full Real Mode Preflight: `docs/evidence/full-real-mode-preflight-issue-308.md`
- Issue: #308
