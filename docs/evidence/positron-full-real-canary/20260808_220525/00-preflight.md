# 00 — #308 Full Real Mode Preflight

**Run ID:** 20260808_220525
**Date:** 2026-08-09T00:30Z

## Preflight Checklist

| Check | Status | Detail |
|-------|--------|--------|
| GITHUB_TOKEN env var | ❌ FAIL | Not set in environment |
| GH_TOKEN env var | ❌ FAIL | Not set in environment |
| gh CLI authentication | ✅ OK | xxammaxx, scopes: gist, read:org, repo (token via keyring) |
| OpenCode CLI | ✅ OK | /home/xxammaxx/.opencode/bin/opencode v1.15.13 |
| SpecKit CLI (specify) | ❌ FAIL | specify binary not found in PATH |
| Sandbox repo access | ✅ OK | xxammaxx/positron-sandbox accessible |
| Open canary issues | ✅ OK | 7 open issues in sandbox |
| Existing open PRs | 6 | Must not conflict with canary |
| NODE_ENV | production (system) | Must be overridden for tests |

## Sandbox Repository

| Property | Value |
|----------|-------|
| Owner | xxammaxx |
| Name | positron-sandbox |
| Default branch | main |
| Private | true |
| Archived | false |

## Available Canary Issues

| Issue | Title | Suitable? |
|-------|-------|-----------|
| #14 | feat: add chunkArray utility | ✅ Small, deterministic, testable |
| #13 | feat: add capitalizeWords utility | ✅ Small, deterministic, testable |
| #10 | feat: add removeDuplicates utility | ✅ Small, deterministic, testable |
| #9 | feat: add countVowels utility | ✅ Small, deterministic, testable |
| #6 | feat: add truncateText utility | ✅ Small, deterministic, testable |
| #2 | fix: preserve version strings in formatTitle | ✅ Small bug fix, testable |

## Required Environment Configuration

To enable Full Real Mode, the following must be configured:

```bash
# Token (must be provided by owner)
export GITHUB_TOKEN=<token-with-repo-scope>

# Adapter modes
export POSITRON_GITHUB_MODE=real
export POSITRON_SPECKIT_MODE=real
export POSITRON_OPENCODE_MODE=real

# Target repository
export POSITRON_REPO_OWNER=xxammaxx
export POSITRON_REPO_NAME=positron-sandbox

# Workspace (real git operations)
export POSITRON_WORKSPACE_ROOT=/tmp/positron-canary-workspaces

# Safety (push enabled, merge blocked)
export POSITRON_ENABLE_PUSH=true
export POSITRON_ENABLE_MERGE=false
export POSITRON_MERGE_KILL_SWITCH=true

# For npm install (system NODE_ENV is production)
export NODE_ENV=development
```

## Missing Dependencies

1. **Spec Kit CLI (specify)**: Must be installed. Options:
   - `npm install -g @github/spec-kit`
   - Or install locally and ensure it's in PATH

2. **GITHUB_TOKEN**: The gh CLI has a valid token (gho_*) with repo scope via keyring,
   but Positron reads GITHUB_TOKEN from environment. The token from gh CLI
   could be extracted via `gh auth token` but must ONLY be done by the owner.

## Classification

```
OWNER_SECRET_PROVISIONING_REQUIRED
```

The sandbox is authorized, OpenCode is available, and suitable canary issues exist.
Blocked by: GITHUB_TOKEN env var (absent) + SpecKit CLI (not installed).

**No secrets have been read, displayed, or stored.**

## Exact Next Action

Owner provides:
1. `export GITHUB_TOKEN=<value>` in this session
2. Install `specify` CLI: `npm install -g @github/spec-kit`
3. Set env vars per configuration above

Then re-run Phase C preflight and proceed to canary execution.
