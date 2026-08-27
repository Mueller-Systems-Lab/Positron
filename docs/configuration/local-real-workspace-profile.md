# Local Real Workspace Profile

> Last updated: 2026-05-30  
> Branch: `positron/issue-58-configure-real-workspace`

## Purpose

This profile enables Positron to execute a full pipeline with real workspace preparation and real SpecKit initialization, while keeping all write operations (push, merge, fix-loop) disabled.

## Prerequisites

| Tool | Required | Check |
|------|----------|-------|
| `git` | ✅ | `git --version` |
| `specify` (SpecKit CLI) | ✅ | `specify --version` → 0.8.5.dev0 |
| `opencode` | ✅ | `opencode --version` → 1.15.5 |
| Node.js 22+ | ✅ | `node --version` |
| GitHub Token | ✅ | In `.env` as `GITHUB_TOKEN` |

## Environment Configuration

### `.env` settings

```ini
# ── Adapter-Modi ─────────────────────────────────────────
POSITRON_GITHUB_MODE=real
POSITRON_SPECKIT_MODE=real
POSITRON_OPENCODE_MODE=real

# ── Feature Flags ────────────────────────────────────────
POSITRON_ENABLE_REAL_SPECKIT=true
POSITRON_ENABLE_PUSH=false
POSITRON_ENABLE_MERGE=false
POSITRON_MERGE_DRY_RUN=true
POSITRON_MERGE_KILL_SWITCH=true
POSITRON_ENABLE_FIX_LOOP=false

# ── Git Workspace ────────────────────────────────────────
POSITRON_WORKSPACE_ROOT=&lt;POSITRON_WORKSPACE_ROOT&gt;

# ── GitHub ────────────────────────────────────────────────
GITHUB_TOKEN=ghp_YOUR_TOKEN
POSITRON_REPO_OWNER=Mueller-Systems-Lab
POSITRON_REPO_NAME=Positron
```

> **Important**: Inline comments (`real   # comment`) break the custom `.env` parser. Place comments on separate lines.

### Workspace directory

```bash
mkdir -p &lt;POSITRON_WORKSPACE_ROOT&gt;
# Verify writable
touch &lt;POSITRON_WORKSPACE_ROOT&gt;/.test && rm &lt;POSITRON_WORKSPACE_ROOT&gt;/.test
```

## Starting the Stack

### Local (non-Docker)

```bash
# Copy .env.example to apps/server/.env
cp .env.example apps/server/.env

# Start server (port 3001 if Docker occupies 3000)
PORT=3001 npx tsx apps/server/src/index.ts

# Start frontend (port 5174 if Docker occupies 5173)
npx vite apps/web --port 5174 --strictPort

# Note: Without Redis, the worker queue falls back to inline execution.
```

### Docker

```bash
# Stop existing Docker stack
docker compose down

# Build and start
docker compose up --build -d
# Starts nginx, redis, server, worker, and web
```

## Verification

### Health check

```bash
curl http://localhost:3001/api/health
# Expected: {"status":"ok","adapters":{"github":true,"specKit":true,"openCode":true},"mode":"real"}
```

### Adapter health

```bash
curl http://localhost:3001/api/adapters/health
# Expected: github.available=true, specKit.available=true, openCode.available=true
```

### Workspace adapter

```bash
curl http://localhost:3001/api/health
# Server log should show: "RealGitWorkspaceAdapter aktiviert (POSITRON_WORKSPACE_ROOT gesetzt)"
```

## Known Limitations

| Area | Status | Reason |
|------|--------|--------|
| REPO_SYNC | ✅ Works | RealGitWorkspaceAdapter creates clone + branch |
| SpecKit initialize | ✅ Works | `specify init` runs successfully |
| OpenCode slash commands | ❌ Fails | `opencode run /speckit.specify` format mismatch |
| Artifact-only fallback | ⚠️ Partial | Creates research artifact but no spec/plan/tasks |
| Push | 🔒 Disabled | `POSITRON_ENABLE_PUSH=false` |
| Merge | 🔒 Disabled | `POSITRON_ENABLE_MERGE=false`, Kill-Switch active |
| Fix-Loop | 🔒 Disabled | `POSITRON_ENABLE_FIX_LOOP=false` |
| GitHub Writes | ❌ Unlimited | GitHub sync fails with 404 (wrong repo) |
| End-to-end | ❌ Blocked | REVIEW blocks because no spec/plan/tasks artifacts |

## Troubleshooting

### Adapter shows `fake` mode
→ Check `.env` for inline comments after values. The custom parser does NOT strip `# comments`.

### Workspace not created
→ Verify `POSITRON_WORKSPACE_ROOT` is set and directory exists and is writable.

### Slash commands fail
→ The `RealOpenCodeAdapter.runSlashCommand()` method may not construct the correct `opencode` CLI invocation. This is a known integration issue with opencode 1.15.5.
