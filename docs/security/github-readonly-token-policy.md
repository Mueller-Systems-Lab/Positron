# GitHub Read-Only Token Policy — Stage 1

## Purpose

Defines the least-privilege token requirements for the Positron Stage 1 Read-Only Validation probe.

## Status

**DRAFT — Not yet executed.** This document defines the policy for a future Stage-1 run. No real token has been created or used during preparation.

## Token Requirements for Stage 1

### Token Type

Fine-grained GitHub Personal Access Token (github_pat_...)

### Required Permissions

| Permission | Level | Purpose |
|---|---|---|
| Contents | Read-only | May be needed for repository metadata |
| Issues | Read-only | Reading issues and comments |
| Pull requests | Read-only | Listing and reading PRs |
| Metadata | Read-only | Repository metadata (always granted) |

### Explicitly Denied Permissions

- **No** write access to any scope
- **No** administration access
- **No** workflow access
- **No** webhook access
- **No** deployment access

## Operational Rules

### Token Lifecycle

1. **Creation:** Token is created manually by the Owner through GitHub UI
2. **Setting:** Token is set ONLY in the local shell environment: `export GITHUB_TOKEN=github_pat_...`
3. **Usage:** Token is used ONLY for the Stage-1 read-only probe
4. **Revocation:** Token is unset (`unset GITHUB_TOKEN`) and revoked through GitHub UI after the probe
5. **No persistence:** Token is NOT stored in .env, NOT committed, NOT saved to any file

### Security Boundaries

| Rule | Description |
|---|---|
| No `.env` storage | Token must never appear in any `.env` file |
| No logging | Token must never appear in logs, errors, or audit events |
| No screenshots | Token must never appear in evidence screenshots |
| No test output | Token must never appear in test output |
| No commit | Token must never be committed to git |
| Owner-only | Token is handled ONLY by the human Owner; Positron never manages the token |

### Redaction Rules

The following patterns must be redacted from all Positron output:

- `ghp_[A-Za-z0-9]{36}` → `ghp_***REDACTED***`
- `github_pat_[A-Za-z0-9_]{82}` → `github_pat_***REDACTED***`
- `GITHUB_TOKEN=...` → `GITHUB_TOKEN=***-redacted-***`
- `Authorization: Bearer ...` → `Authorization: Bearer ***-redacted-***`
- `X-Admin-Token: ...` → `X-Admin-Token: ***-redacted-***`

Redaction helpers exist in:
- `packages/shared/src/utils.ts` — `redactValue()`
- `packages/shared/src/secret-manager.ts` — `SecretManager`
- `apps/server/src/sse/broadcaster.ts` — SSE redaction
- `apps/web/src/voice/redact-for-speech.ts` — Voice redaction

## Audit Requirements for Stage 1

All Stage-1 operations must be audited. Audit events must include:

- Operation name (e.g., `getIssue`, `listPullRequests`)
- Repository (e.g., `Mueller-Systems-Lab/Positron`)
- Issue/PR number (if applicable)
- Result status (success/failure/denied)
- Timestamp

Audit events must NEVER include:

- Token values
- Authorization headers
- Raw HTTP responses containing authentication data
- Token-like patterns

## Pre-Flight Checks (Before Stage-1 Execution)

Before executing the Stage-1 probe, verify:

- [ ] Token is fine-grained with read-only scopes only
- [ ] Token has access ONLY to `Mueller-Systems-Lab/Positron`
- [ ] Token is NOT hardcoded in any file
- [ ] `POSITRON_GITHUB_MODE=real` is NOT set (kept at default)
- [ ] `POSITRON_ENABLE_PUSH=true` is NOT set
- [ ] `POSITRON_MERGE_KILL_SWITCH=false` is NOT set
- [ ] No `.env` file in workspace root
- [ ] Audit sink is configured and writable
- [ ] Redaction pipeline is active

## Post-Run Cleanup

After the Stage-1 probe:

- [ ] `unset GITHUB_TOKEN`
- [ ] Revoke token through GitHub UI
- [ ] Verify no token in logs: `grep -r "ghp_\|github_pat_" .opencode/logs/ --exclude-dir=node_modules`
- [ ] Archive audit log
- [ ] Document probe results in Issue #308
