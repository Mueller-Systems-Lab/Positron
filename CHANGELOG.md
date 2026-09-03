# Changelog

All notable project closeout changes are tracked here.

## Unreleased

## 0.3.0

### Added

- Installed supervised onboarding through `positron configure supervised` and
  explicit supervised lifecycle commands.
- Versioned `positron.supervised-config.v1` user configuration with protected
  secret handling and automatic OpenCode/SpecKit discovery.

### Safety

- Plain `positron start` remains the fake/demo default.
- Supervised startup reuses the existing advanced Compose/runtime path;
  repository-scoped push is opt-in, merge remains disabled, and the merge
  kill switch remains active.

See [v0.3.0 release notes](docs/release/v0.3.0.md). Stable publication is
pending final release qualification.

## 0.2.0

### Added

- Operator readiness v1 with backend-backed, actionable blocked states and a clear demo versus supervised distinction.
- Installation doctor v1 with `--demo`, `--supervised`, `--json`, stable reason codes, and remediation guidance.
- Reliable Quickstart first-build flow using one shared server/worker dependency and workspace build path with visible Docker progress.
- Runtime budget v1 with hierarchical budgets/deadlines, precise termination reasons, provider-health separation, and late-result fencing.

### Changed

- The v0.2.0 product version is aligned across all current workspace manifests, runtime version surface, and lockfile metadata.
- Progressive localization v1 was evaluated and rejected; no exploration specialization or skill specialization is activated.

### Safety

- Fake/demo remains the default; push and merge remain disabled by default, with the merge kill switch active.
- Unsupervised productive Real Mode remains gated and is not claimed by this release. No deployment or package publication is included.

### Issue #465 release hardening

- Durable control-plane state now has documented migration, online backup/
  restore, restart-recovery, approval-consumption and decision-reconciliation
  contracts.
- External mutation uses persistent SQLite locking and fencing; stale owners
  are rejected before a writer is invoked.
- Local E2E is hermetic and supervised Real Mode remains the only validated
  Real Mode. Unsupervised and production autonomous Real Mode remain disabled
  and unproven.
- The portfolio consolidation architecture remains under Positron's single
  control plane; legacy source identities from #447/#464 are separate evidence
  blockers, not a new #465 runtime dependency.

### Changed

- **R3 Clean-Checkout Test Contract:** `npm test` is self-contained — `pretest` runs `npm run build`, then Root Vitest (84 files, 2173 tests) and Web Vitest (18 files, 399 tests) execute. Combined unique unit suite: 102 files, 2572 tests (provably disjoint).
- **R3-R1 CI Self-Contained Proof:** PR [#415](https://github.com/xxammaxx/Positron/pull/415) removed the redundant workflow-level build inside `unit-tests`, proving `npm ci` → `npm test` is sufficient.
- **R3-R2 Test-Truth and Documentation Synchronization:** All current documentation (README, CONTRIBUTING, CI Policy, status docs, CI diagram) synchronized with measured test truth at SHA `3a9a116`. CI Policy updated from v1 (advisory-only) to v2 (local-first, remote-required) reflecting current branch protection. Issue [#416](https://github.com/xxammaxx/Positron/issues/416).

### Known Limitations

- GitHub-CI is now required for protected-branch merge (6 required checks). Issue [#268](https://github.com/xxammaxx/Positron/issues/268) is CLOSED.
- Biome lint backlog remains open ([#340](https://github.com/xxammaxx/Positron/issues/340)).
- Issue [#279](https://github.com/xxammaxx/Positron/issues/279) tracks the architecture replacement path for the old [#229](https://github.com/xxammaxx/Positron/issues/229) PR chain.

### Added

- Project closeout status documentation.
- Mermaid architecture baseline diagrams.
- MIT `LICENSE`.
- Repository governance documentation: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.
- GitHub issue and pull request templates.
- Closeout release notes and evidence handoff.
