---
title: Positron v3.0 Development Workflow
date: 2026-05-24
author: Positron Team
---

# Development workflow

## Prerequisites

- Node.js **v22+**
- npm **10+**
- git

## Installation

```bash
npm ci
```

## Configuration

1. Copy the example environment file:

```bash
cp .env.example apps/server/.env
```

2. Edit `apps/server/.env`.

3. Use the runtime variable names from the codebase. The server reads `POSITRON_DB_PATH`; if you start from the example file, rename `DB_PATH` to `POSITRON_DB_PATH` or add both.

Common values:

- `POSITRON_GITHUB_MODE=fake|real` (preferred; falls nicht gesetzt, wird `GITHUB_MODE` als Legacy-Fallback gelesen)
- `GITHUB_MODE=fake|real` (legacy fallback)
- `POSITRON_REPO_OWNER=...`
- `POSITRON_REPO_NAME=...`
- `POSITRON_ENABLE_PUSH=true|false`
- `POSITRON_ENABLE_MERGE=true|false`
- `POSITRON_MERGE_KILL_SWITCH=true|false`
- `POSITRON_SPECKIT_MODE=fake|real`
- `POSITRON_OPENCODE_MODE=fake|real`
- `POSITRON_ENABLE_WATCHER=true|false`
- `POSITRON_WATCHER_INTERVAL_MS=60000`
- `POSITRON_WATCHER_LABELS=bug,feature`

## Build

```bash
npm run build
```

## Run the server

```bash
node apps/server/dist/index.js
```

## Run the frontend dev server

```bash
cd apps/web && npm run dev
```

## Run the CLI

```bash
positron run --issueNumber 42 --autonomyLevel 2
```

The CLI requires the server to be running and defaults to `http://localhost:3000`.
See [`docs/workflows/cli.md`](./cli.md) for the full command reference.

## Run tests

Root test suite:

```bash
npm test
```

Web app tests:

```bash
cd apps/web && npm test
```

## Type checking

```bash
npm run typecheck
```

## Clean build

```bash
npm run clean && npm run build
```

## Troubleshooting

- **Server fails with missing repository config**: set `POSITRON_REPO_OWNER` and `POSITRON_REPO_NAME` in `apps/server/.env`.
- **Database errors**: ensure the process can write to the SQLite path; the default is `~/.positron/positron.db`.
- **Real GitHub mode is rate-limited**: set `GITHUB_TOKEN` when using `POSITRON_GITHUB_MODE=real` (or the legacy `GITHUB_MODE=real`).
- **Local application merge status is blocked**: check `POSITRON_ENABLE_MERGE`, `POSITRON_MERGE_KILL_SWITCH`, and `POSITRON_ENABLE_PUSH`. These runtime safety controls are separate from the repository PR lifecycle.
- **Frontend cannot reach the API**: confirm the server is running and listening on the expected port.
- **TypeScript build errors after a clean**: rerun `npm ci`, then `npm run clean && npm run build`.

## Canonical PR merge policy

`MERGE_POLICY=PLAYWRIGHT_GATED` applies to repository pull requests. After all
required acceptance gates pass, the canonical merge action is allowed only
through the visible, Playwright-controlled GitHub web interface. CLI, REST,
GraphQL, bot, direct-main-push, and local-merge merge actuators are not valid
substitutes. The runtime safety controls above remain intentionally fail-closed
for Positron's in-application merge operation.
