# Positron — Evidence-Gated AI Agent for Autonomous GitHub Issue Resolution

[![Version](https://img.shields.io/badge/version-v0.2.0--rc.1-blue.svg)](https://github.com/xxammaxx/Positron/releases)
[![Tests](https://img.shields.io/badge/tests-2598%20passing-brightgreen.svg)](https://github.com/xxammaxx/Positron/actions)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker)](https://github.com/xxammaxx/Positron)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20(CI)%20%7C%2024%20(dev)-339933?logo=node.js)](https://nodejs.org/)

**Positron** is an evidence-gated AI agent execution system for GitHub Issues. It runs a **28-phase pipeline** (QUEUED → CLAIMED → SPECIFY → PLAN → TASKS → IMPLEMENT → REVIEW → MERGE → DONE → CLEANUP) where every phase produces verifiable artifacts. A happy-path run progresses through ~17 execution phases. Each step is auditable, replayable, and gated by evidence requirements.

> **🇩🇪 German:** Positron ist ein agentisches Ausführungssystem für GitHub Issues. Es durchläuft eine 28-Phasen-Pipeline (QUEUED → CLAIMED → SPECIFY → PLAN → TASKS → IMPLEMENT → REVIEW → MERGE → DONE → CLEANUP) und produziert für jeden Schritt prüfbare Artefakte.

---

## Demo

[▶️ Watch the Demo Video](docs/release/video-demo/positron-v0.2.0-demo.webm)

![Dashboard](docs/screenshots/dashboard.png)
*Dashboard — Real-time SSE updates, run queue, system health*

| Evidence Explorer | Admin Panel | Run Detail |
|:---:|:---:|:---:|
| ![Evidence](docs/screenshots/evidence.png) | ![Admin](docs/screenshots/admin.png) | ![Run Detail](docs/screenshots/run-detail.png) |

---

## Quickstart

### Docker (Production — Full Stack)

```bash
cp .env.example apps/server/.env
# Edit apps/server/.env: set GITHUB_TOKEN, real modes
docker compose up --build
# → http://localhost:5173 (nginx reverse proxy)
```

### Local Development

```bash
cp .env.example apps/server/.env
npm install
# Terminal 1: Server
npm run dev:server
# Terminal 2: Web frontend
npm run dev:web
# → http://localhost:5173
# Note: Without Redis, the worker queue falls back to inline execution.
```

> **Windows users:** See the [Windows Local Installer Guide](docs/install/windows-local-installer.md) for a one-command setup with PowerShell scripts.

### Local Development (with Redis + Worker)

```bash
# Terminal 1: Redis
docker compose up redis -d
# Terminal 2: Worker
cd apps/worker && npm run dev
# Terminal 3: Server
npm run dev:server
# Terminal 4: Web
npm run dev:web
```

### CLI

```bash
./positron health           # System check
./positron runs             # Last 20 runs
./positron stats            # Admin statistics
./positron cancel <run-id>  # Cancel a run
```

---

## Key Features

- **🚀 28-Phase Pipeline** — QUEUED → CLAIMED → SPECIFY → PLAN → TASKS → IMPLEMENT → REVIEW → MERGE → DONE → CLEANUP. Each phase has mandatory evidence gates.
- **📊 Real-Time Dashboard** — SSE-powered live updates, run queue management, attention metrics, system health indicators.
- **🔍 Evidence Explorer** — Browse artifacts, test results, screenshots, and logs from every pipeline phase.
- **⚙️ Admin Panel** — Bulk cancel/retry, database statistics, workspace cleanup, system configuration.
- **🛡️ Safety Gates** — Kill-switch (`POSITRON_MERGE_KILL_SWITCH`), rate-limiting, CSP headers, secret redaction, audit trail enforcement.
- **🔔 Notifications** — Slack/Discord webhooks for run completion, failures, and state changes.
- **🐳 Docker** — Single `docker compose up --build` deploys the full stack (redis, worker, server, web, nginx).
- **📝 CLI** — `positron health`, `runs`, `stats`, `cancel`, `status` for operational management.
- **🎨 Brutalist Design** — Dark/light theme, mobile-responsive, accessible UI.

---

## Safety Architecture

Positron implements **evidence-gated progression** — no phase completes without verifiable proof:

| Layer | Mechanism | Enforced By |
|-------|-----------|-------------|
| **Merge Gate** | `POSITRON_MERGE_KILL_SWITCH=true` blocks all merges | Server-side config |
| **Push Gate** | `POSITRON_ENABLE_PUSH=false` blocks git pushes | Server-side config |
| **Evidence Gate** | Each pipeline phase requires passing tests + captured artifacts | Pipeline engine |
| **Audit Trail** | Every agent decision logged with timestamps + evidence hashes | Audit enforcer |
| **Rate Limiting** | Maximum 100 requests/minute per IP | Express middleware |
| **Secret Redaction** | `GITHUB_TOKEN`, API keys masked in logs | Log sanitizer |
| **Max Fix Loops** | Automatic stop after 3 failed attempts | State machine |

---

## Configuration

All settings via environment variables or `apps/server/.env`:

| Variable | Default | Description |
|:---------|:--------|:------------|
| `GITHUB_MODE` | `fake` | `real` for actual GitHub access |
| `GITHUB_TOKEN` | — | GitHub Personal Access Token |
| `POSITRON_ENABLE_PUSH` | `false` | Allow git push |
| `POSITRON_ENABLE_MERGE` | `false` | Allow auto-merge |
| `POSITRON_MERGE_KILL_SWITCH` | `true` | Emergency stop |
| `POSITRON_WORKSPACE_ROOT` | — | Path for real workspace |
| `POSITRON_WEBHOOK_URL` | — | Slack/Discord webhook |

---

## Tests

At SHA `ed70487` on 2026-08-08:

```bash
npm test   # Self-contained: pretest → build → root + Web Vitest
```

- Root Vitest suite (Vitest 4.1.7, node environment): **88 files, 2199 passed, 0 failed, 0 skipped, 0 todo**
- Web Vitest suite (Vitest 1.6.1, jsdom environment): **18 files, 399 passed, 0 failed, 0 skipped, 0 todo**
- Combined unique unit suite: **106 files, 2598 passed** (root and Web test files are provably disjoint)
- E2E tests: Playwright (separate suite; tracing instability [#304](https://github.com/xxammaxx/Positron/issues/304) was CLOSED 2026-07-30)

`npm test` is self-contained: `pretest` runs `npm run build` (TypeScript compilation of all packages), then root Vitest executes, followed by Web Vitest.

See [Current Project Status](#current-project-status) for local gate results and required CI checks.

---

## Architecture

```
Positron/
├── apps/
│   ├── server/        # Express/TypeScript Backend (Port 3000)
│   │   ├── src/
│   │   │   ├── routes/        # REST API routes
│   │   │   ├── middleware/    # Auth, rate-limit, logging
│   │   │   └── services/     # Pipeline orchestration
│   │   └── __tests__/
│   └── web/           # React/Vite/Tailwind Frontend (Port 5173)
│       ├── src/
│       │   ├── components/   # Dashboard, Evidence, Admin, Runs
│       │   ├── hooks/        # SSE, API consumers
│       │   └── __tests__/
│       └── e2e/
├── packages/
│   ├── github-adapter/    # GitHub API (Fake/Real modes)
│   ├── speckit-adapter/   # Spec-Kit CLI integration
│   ├── opencode-adapter/  # OpenCode CLI integration
│   ├── run-state/         # State machine + SQLite
│   ├── sandbox/           # Git workspace (Fake/Real)
│   └── shared/            # Types, SSE events, utilities
├── docs/
│   ├── screenshots/       # Product screenshots
│   └── release/          # Release artifacts, proof reports
└── docker-compose.yml
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 22 (CI-pinned) / 24 (development verified) |
| **Language** | TypeScript 5.4 |
| **Frontend** | React 18, Vite 5.4, Tailwind CSS 3 |
| **Backend** | Express 5, SQLite (better-sqlite3) |
| **State Machine** | Custom pipeline engine (28 phases) |
| **E2E Testing** | Playwright 1.60 |
| **Unit Testing** | Vitest 4.1 (root) / 1.6 (web) |
| **Container** | Docker + docker-compose |

---

## Dogfood Results (v0.1.0+)

Historical reference — counts reflect the state at their respective SHAs:

At the v0.1.0/v0.2.0 dogfood SHAs:
- **28-Phase State Machine**: Happy path (CLAIMED → DONE) completed in **13.7 seconds**
- **Rudolph Beacon Benchmark**: Controlled real-mode probe with safety gate validation ([#279](https://github.com/xxammaxx/Positron/issues/279))
- **CI Recovery**: Workflow configuration repaired ([#268](https://github.com/xxammaxx/Positron/issues/268), [#296](https://github.com/xxammaxx/Positron/pull/296))
- **SSE Live Updates**: Dashboard + Event Timeline functional
- **PR Auto-Creation**: Blocked by Kill-Switch as configured
- **Evidence Trail**: Complete with screenshots, logs, test results

> Full proof: `docs/release/ui-workflow-proof-report.md`

---

## Current Project Status

### Mandatory local gates

- `git diff --check`
- `npx biome format .`
- `npm run build`
- `npm run typecheck`
- `npm test` — **2598/2598 passing** (106 test files: 88 root + 18 Web, 0 overlap)

### Required CI checks (branch protection)

6 checks are required for merge to `main`:

| Check | Description |
|-------|-------------|
| `format-check` | Biome format (all files) |
| `differential-lint` | Differential Biome lint (new/worsened only) |
| `build` | TypeScript build (all packages) |
| `typecheck` | TypeScript typecheck |
| `unit-tests` | `npm ci` → `npm test` (self-contained) |
| `observability-config-check` | Prometheus/Alertmanager config validation |

Advisory jobs: `full-lint-report`, `e2e-playwright`, `mutation-fast`, `mutation-safety`, `tool-gateway-windows`.

### Known limitations

- **Biome lint backlog**: `npx biome check .` remains advisory-only ([#340](https://github.com/xxammaxx/Positron/issues/340)).
- **E2E tests**: tracing lifecycle instability ([#304](https://github.com/xxammaxx/Positron/issues/304), CLOSED 2026-07-30); not currently required locally.
- **Full Real Mode**: Not yet productively validated ([#308](https://github.com/xxammaxx/Positron/issues/308)).

### See also

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CHANGELOG.md](CHANGELOG.md)
- [`docs/status/current-capabilities.md`](docs/status/current-capabilities.md)
- [`docs/status/known-limitations.md`](docs/status/known-limitations.md)
- [`docs/architecture/local-ci-flow.mmd`](docs/architecture/local-ci-flow.mmd)
- [`docs/architecture/evidence-flow.mmd`](docs/architecture/evidence-flow.mmd)
- [`docs/architecture/agent-flow.mmd`](docs/architecture/agent-flow.mmd)
- [`docs/architecture/ki-solution-system-map.mmd`](docs/architecture/ki-solution-system-map.mmd)
- [`docs/architecture/ki-solution-decision-flow.mmd`](docs/architecture/ki-solution-decision-flow.mmd)
- [`docs/specs/issue-279-phase-0.md`](docs/specs/issue-279-phase-0.md) — KI-Lösung Architecture Spec

---

## License

MIT

---

*Built with TypeScript, React, Vite, Tailwind CSS, Express, SQLite, Docker, and Playwright.*
