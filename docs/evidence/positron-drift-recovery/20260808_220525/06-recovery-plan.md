# 06 — Recovery Target & Plan

**Run ID:** 20260808_220525

---

## I. Recovery Target — Canonical Baseline

### What is Positron?

Positron is an evidence-gated, autonomous/semi-autonomous GitHub Issue-to-Code pipeline: given a repository and an issue, it orchestrates Spec Kit (specify → plan → tasks) and an AI coding agent (implement → test → fix) to produce verifiable code changes and a pull request, with human gates at key decision points.

### What concrete problem does it solve?

Transforming a GitHub Issue into a reviewed, tested, evidence-backed pull request without manual step-by-step orchestration — reducing the mechanical overhead of issue-to-code workflows while maintaining verifiable safety and audit trails.

### Primary Happy Path (current architecture)

```
GitHub Issue (ingested via poll/webhook/manual)
    ↓
Repository understanding (clone/analyze workspace)
    ↓
Spec Kit: Specify → Clarify (optional) → Plan → Tasks → Analyze
    ↓
OpenCode/Coding Agent: Implement → Test → Fix loop (max 3)
    ↓
Verification: Lint, Typecheck, Test, Evidence
    ↓
Git: Commit → Push (gated) → PR Create (gated) → Merge (gated)
    ↓
Human Gate at push/merge boundaries
    ↓
Resume/restart recovery for interrupted runs
```

### Mandatory Components

| Component | Why Mandatory |
|-----------|---------------|
| apps/server | REST API, SSE, pipeline orchestration |
| apps/web | Operator dashboard, run management |
| packages/run-state | 28-phase state machine + persistence |
| packages/github-adapter | GitHub API (fake + real) |
| packages/shared | Types, utilities, secret management |
| packages/sandbox | Git workspace isolation + test running |
| packages/speckit-adapter | Spec Kit CLI integration |
| packages/opencode-adapter | AI coding agent integration |

### Optional Components

| Component | Why Optional |
|-----------|-------------|
| apps/worker | BullMQ worker — runs pipeline in separate process; server can run inline |
| packages/tool-gateway | MCP tool security enforcement — adds safety layer but not core path |
| packages/benchmark-rudolph | Dead code — zero consumers; can be removed |
| Redis | Required only by worker; server uses in-memory queue fallback |
| Docker | Deployment platform, not core logic |
| observability/ | Prometheus/Grafana — monitoring, not core product |

### Autonomy Levels

| Level | Name | Real Runtime Difference |
|-------|------|------------------------|
| 0 | Observer | Read-only GitHub adapter, no writes |
| 1 | Research & Spec | Spec Kit runs, no code changes |
| 2 | Supervised Build | Code changes with ask-gates, push requires approval |
| 3 | Autonomous Sandbox | Autonomous in isolated workspace, no main merge |
| 4 | CI Auto-PR | Auto PR creation, merge only with green checks |

### When is Positron "working"?

1. All local gates pass: `npm run build`, `npm run typecheck`, `npm test`
2. A real-mode end-to-end run completes: GitHub Issue → Spec → Plan → Tasks → Implement → Tests → Evidence → Commit → PR (draft)
3. No duplicate GitHub mutations
4. No cross-run contamination
5. Resume after controlled interruption works
6. Human gate functions correctly (push/merge blocked without approval)

---

## II. Recovery Plan — Dependency-Ordered Workstreams

### Priority: P0 (Product Correctness / Security) → P1 (Broken End-to-End) → P2 (Architecture) → P3 (Runtime/Test Match) → P4 (Documentation) → P5 (Cosmetic)

### R0: Canon & Source-of-Truth Reconciliation (P4) — IMMEDIATE

**Goal:** Align version numbers and stale documentation with reality.

| File | Change | Why |
|------|--------|-----|
| README.md | Fix version badge (v0.3.0 → aligned), fix Express version (4 → 5), fix test counts (2572 → 2598), fix file counts | D-001, D-003, D-004 |
| package.json | Consider version alignment (currently 0.1.0) | D-001 |
| CHANGELOG.md | Update with recent changes since last release | D-001 |

### R1: Commit Working Tree Cleanup (P4) — IMMEDIATE

**Goal:** Reduce 94 files of uncommitted drift. Commit tracked changes, decide on untracked files.

| Action | Scope |
|--------|-------|
| Review and commit or revert 23 modified files | apps/server, apps/web, apps/worker, biome.json, docker files, packages |
| Decide on 71 untracked files | Commit runcards/reports to evidence, or .gitignore them |
| Clean 14 active worktrees | Prune completed issue-340 tracks |

### R2: Real Execution Path — Vertical Slice (P0) — BLOCKED BY #308

**Goal:** Prove Positron's primary mission with at least one real-mode end-to-end run.

This requires owner decision on whether to execute a real-mode canary. Per safety rules (Constitution IX), this needs explicit authorization and proper environment setup.

**Blocker:** Stage 3 was never executed. Full Real Mode (#308) remains open. This requires:
- `POSITRON_GITHUB_MODE=real` + valid `GITHUB_TOKEN`
- `POSITRON_WORKSPACE_ROOT` set
- `POSITRON_SPECKIT_MODE=real` (if Spec Kit CLI is available)
- `POSITRON_OPENCODE_MODE=real` (if OpenCode CLI is available)

### R3: Auth Contract Fix (P1)

**Goal:** Fix 5 frontend-backend auth mismatches.

| Method | Endpoint | Fix |
|--------|----------|-----|
| `createRepo` | POST /api/repos | Use `adminRequest()` |
| `startRun` | POST /api/repos/:repoId/runs | Use `adminRequest()` |
| `saveEvidence` | POST /api/evidence | Use `adminRequest()` |
| `updateSafety` | POST /api/safety | Use `adminRequest()` |
| `cancelRun` | POST /api/runs/:id/cancel | Use `adminRequest()` |

Files: `apps/web/src/api.ts` (or equivalent)

### R4: Dead Code Removal (P2)

**Goal:** Remove or archive unused code.

| Component | Action |
|-----------|--------|
| packages/benchmark-rudolph/ | Remove from build chain OR archive to historical evidence |
| deletable-branches-manifest.json | Either delete the listed branches or remove the manifest |

### R5: Architecture Simplification (P2)

**Goal:** Reduce complexity where it doesn't serve product goals.

| Observation | Recommendation |
|-------------|---------------|
| Server index.ts at 4696 lines | Split into modules (routes/, pipeline/, adapters/) |
| Duplicate executePhase() in server + worker | Consolidate into shared package or single canonical location |
| 55 local branches + 85 un-deleted merged branches | Run branch cleanup (keep only active + recent) |
| 14 active worktrees (9 for issue-340) | Prune completed tracks |

### R6: Documentation Reconciliation (P3)

**Goal:** After R0-R5, synchronize all documentation.

| Document | Action |
|----------|--------|
| README.md | Full accuracy pass |
| docs/status/current-capabilities.md | Update to current HEAD |
| docs/status/known-limitations.md | Update resolved items |
| CHANGELOG.md | Add recent changes |
| All docs referencing test counts | Update to 2598 |

---

## III. Repair Execution Order

```
R0 (Version + Doc Fix) → IMMEDIATE, low risk
  ↓
R1 (Working Tree Cleanup) → IMMEDIATE, requires decisions on untracked files
  ↓
R3 (Auth Contract Fix) → P1, code change, requires testing
  ↓
R4 (Dead Code) → P2, removal, requires build verification
  ↓
R5 (Architecture) → P2, refactoring, higher risk — DEFER without owner approval
  ↓
R6 (Doc Sync) → P3, after code changes stabilize
  ↓
R2 (Real Mode) → P0, BLOCKED by #308 + owner authorization + environment setup
```
