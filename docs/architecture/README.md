---
title: Positron v3.0 Architecture
date: 2026-05-24
author: Positron Team
---

# Positron v3.0 — Architecture

The current consolidation topology and legacy-source boundaries are documented
in [Architecture After #447](architecture-after-consolidation.md). It ratifies
one Positron controller and keeps OpenCode-Agenten-Oekosystem as a separate
companion distribution layer.

Positron is an evidence-gated GitHub issue execution system: the web UI requests work, the server orchestrates a deterministic run state machine, adapters encapsulate external systems, and SQLite persists every run, event, and artifact so progress can be resumed and audited.

## Technology stack

| Technology | Role |
| --- | --- |
| React | Web UI component model |
| Node.js | Runtime for the orchestrator and adapters |
| Express | REST + SSE HTTP server |
| SQLite | Persistent run/event/artifact storage |
| Vitest | Unit and integration testing |
| Tailwind | UI styling system |
| Vite | Frontend dev server and production bundler |
| TypeScript | Shared implementation language across packages |

## Architecture diagram

```text
+----------------------+       REST / SSE       +----------------------+
|       Web UI         | <--------------------> |        Server        |
|   React / Vite       |                        |   Express / TS       |
+----------------------+                        +----------+-----------+
                                                           |
                                                           | adapter calls
                                                           v
                                             +-------------+-------------+
                                             | Adapters / Orchestrators  |
                                             | GitHub / SpecKit / Open   |
                                             | Sandbox / Run-State       |
                                             +-------------+-------------+
                                                           |
                                                           | SQL
                                                           v
                                               +----------------------+
                                               |       SQLite         |
                                               | runs / events / data |
                                               +----------------------+
```

## Module dependency graph

`→` means “is imported by”.

```text
shared ─→ run-state ─→ server
shared ─→ sandbox ─→ opencode-adapter ─→ server
shared ─→ github-adapter ───────────────→ server
shared ─→ speckit-adapter ──────────────→ server
server  ↔ web (HTTP API + SSE; no code imports)
```

## Run data flow

1. A repository is registered and an issue is selected.
2. The server creates a run in `QUEUED` with `status=active` and `attempt=1`.
3. The GitHub adapter claims the issue and records evidence in GitHub comments and labels.
4. The sandbox prepares an isolated workspace and branch named `positron/issue-<n>-<slug>`.
5. SpecKit generates the specification artifacts (`spec`, `plan`, `tasks`, review outputs).
6. OpenCode performs implementation work in the workspace.
7. Tests run in the sandbox; results are recorded as events and artifacts.
8. The server verifies evidence, creates or updates the PR, and optionally merges when gates are open.
9. The run ends in `DONE` or a failure state (`FAILED_TRANSIENT`, `FAILED_BLOCKED`, `FAILED_UNSAFE`).

State progression in the current implementation:

```text
QUEUED → CLAIMED → REPO_SYNC → ISSUE_CONTEXT → WEB_RESEARCH → SPECIFY
→ CLARIFY_OPTIONAL → PLAN → TASKS → ANALYZE → REVIEW → IMPLEMENT
→ TEST → VERIFY → COMMIT → PR_CREATE → MERGE → DONE
```

## Key design patterns

- **State Machine**: `packages/run-state` owns valid transitions and run lifecycle rules.
- **Adapter**: GitHub, SpecKit, OpenCode, and sandbox integrations are wrapped behind package interfaces.
- **Factory**: the server resolves real vs fake implementations from environment variables and constructor options.
- **Dependency Injection**: `createApp()` accepts injected adapters and repository configuration for tests and alternate runtimes.

## Security model

- **Branch policy**: only `positron/issue-<number>-<slug>` branches are accepted; `main`, `master`, and `develop` are protected.
- **Push policy**: force flags (`--force`, `-f`, `--force-with-lease`) are blocked and pushes require `POSITRON_ENABLE_PUSH=true`.
- **Env-based gates**: merge and fix-loop behavior are controlled with `POSITRON_ENABLE_MERGE`, `POSITRON_MERGE_DRY_RUN`, `POSITRON_MERGE_KILL_SWITCH`, `POSITRON_ENABLE_FIX_LOOP`, and related flags.
- **Fake vs real modes**: GitHub, SpecKit, and OpenCode all default to fake/test doubles unless explicitly switched to real mode.
- **Secret protection**: redaction is applied before logging and before propagating external error messages.
