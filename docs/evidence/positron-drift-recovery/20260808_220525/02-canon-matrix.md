# 02 — Canon Candidate Matrix

**Run ID:** 20260808_220525

## Sources Audited

1. README.md (HEAD: ed70487)
2. package.json (version 0.1.0)
3. `.specify/memory/constitution.md` (10 articles)
4. Blueprint.md
5. AGENTS.md
6. docs/status/current-capabilities.md (SHA 3a9a116)
7. docs/status/known-limitations.md
8. docs/status/north-star-trilogy-index.md (FROZEN R4)
9. docs/status/positron-capability-baseline-v1.md
10. CHANGELOG.md
11. CONTRIBUTING.md
12. SECURITY.md
13. docs/adr/ (multiple ADRs)
14. docs/release/ (ui-workflow-proof-report.md)
15. docs/evidence/positron-north-star/ (R1-R6)
16. Various runcards (POS-NORTHSTAR-R1 through R6)
17. Runtime behavior (verified via build + test + typecheck)
18. TASK DOCUMENT: POSITRON — FULL REPOSITORY DRIFT RECOVERY & NORTH-STAR REALIGNMENT.md

## Verdict Explanations

- **CANONICAL**: Claim is accurate, current, and reflected in code + docs
- **SUPERSEDED**: Claim was intentional but has been replaced by a newer decision
- **STALE**: Claim was once true but no longer accurate
- **HISTORICAL_ONLY**: Claim was true at a specific point in time, marked as historical
- **IMPLEMENTATION_DRIFT**: Code exists but doesn't match docs or hasn't been proven
- **DOCUMENTATION_DRIFT**: Docs claim something the code doesn't deliver
- **UNDECIDED**: Conflicting claims with no clear resolution

## Matrix

| # | Claim | Source(s) | Still Current? | Verdict |
|---|-------|-----------|---------------|---------|
| 1 | "Evidence-Gated GitHub Issue Execution System" | package.json description | Yes | CANONICAL |
| 2 | "28-Phase Pipeline (QUEUED → ... → CLEANUP)" | README, Blueprint §5.2 | Yes | CANONICAL |
| 3 | "Evidence-gated progression" | Constitution IV | Yes | IMPLEMENTATION_DRIFT (fake-mode only) |
| 4 | "GitHub Issue → Spec → Plan → Tasks → Implement → PR" | North Star, Blueprint | Yes | IMPLEMENTATION_DRIFT (fake-mode only) |
| 5 | "Positron = Orchestrator, Spec Kit = Planning, OpenCode = Execution" | Constitution III | Yes | CANONICAL |
| 6 | "Version v0.3.0" | README badge | No (actual: 0.1.0) | VERSION_DRIFT |
| 7 | "Express 4" | README Tech Stack | No (actual: 5.1.0) | DOCUMENTATION_DRIFT |
| 8 | "React 18, Vite 5.4" | README | Yes | CANONICAL |
| 9 | "TypeScript 5.4" | README, package.json | Yes | CANONICAL |
| 10 | "Node.js 22 (CI) / 24 (dev)" | README | Partially (22.22.0) | STALE |
| 11 | "SQLite (better-sqlite3)" | README, package.json | Yes | CANONICAL |
| 12 | "2572 tests" | README | No (actual: 2598) | STALE |
| 13 | "84 root test files, 2173 passed" | README | No (actual: 88 files, 2199) | STALE |
| 14 | "6 required CI checks for merge" | README, current-capabilities.md | Yes | CANONICAL |
| 15 | "Kill-switch (POSITRON_MERGE_KILL_SWITCH)" | README, code | Yes | CANONICAL |
| 16 | "Stage 3: IMPLEMENTED_AND_TESTED_NOT_EXECUTED" | known-limitations.md | Yes | IMPLEMENTATION_DRIFT |
| 17 | "Full Real Mode not productively validated" | known-limitations.md, #308 | Yes | IMPLEMENTATION_DRIFT |
| 18 | "Biome lint backlog (#340)" | known-limitations.md | Yes | CANONICAL |
| 19 | "Spec before Code" | Constitution II, AGENTS.md | Yes | CANONICAL |
| 20 | "Small, Reversible Changes" | Constitution VI | Yes | CANONICAL |
| 21 | "No Silent Failure" | Constitution VII | Yes | CANONICAL |
| 22 | "Resume by State, Not by Memory" | Constitution VIII | Yes | CANONICAL (PR #419) |
| 23 | "Human Override Always Wins" | Constitution X | Yes | CANONICAL |
| 24 | "Docker ready" | README badge | Partially | IMPLEMENTATION_DRIFT (modified files) |
| 25 | "Local gates are mandatory pre-PR" | current-capabilities.md | Yes | CANONICAL |
| 26 | "PR #420: parallel run isolation" | GitHub | Yes | IN_FLIGHT |
| 27 | "Rudolph Beacon benchmark (#279, CLOSED)" | current-capabilities.md | Yes | CANONICAL (but dead code) |
| 28 | "v0.2.0-rc.1 release tag" | Git tags | Yes | HISTORICAL_ONLY |
| 29 | "North Star Trilogy FROZEN at R4" | north-star-trilogy-index.md | Yes | CANONICAL (R5, R6 untracked) |
| 30 | "5 admin auth mismatches" | known-limitations.md | Yes | IMPLEMENTATION_DRIFT |
| 31 | "BullMQ/Redis for job queue" | code, docker-compose.yml | Yes | CANONICAL |
| 32 | "Server + Worker separate processes" | code structure | Yes | CANONICAL |
| 33 | "Tool Gateway with Red Team tests" | current-capabilities.md | Yes | CANONICAL |
| 34 | "Dogfood Results (v0.1.0+)" | README | Partially | HISTORICAL_ONLY |
