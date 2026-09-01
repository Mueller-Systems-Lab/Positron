# Current Capabilities

**Status date:** 2026-09-01
**Baseline:** `03febdb6f429bca713a49d4f19cc12453d091e60`
**Product status:** stable v0.1.0 / v0.2 product work active

This is living documentation. Dated test totals and historical issue snapshots belong in `docs/evidence/` and are not repeated here as timeless claims.

## Capability matrix

| Capability | Status | Current evidence / boundary |
| --- | --- | --- |
| Controller-owned issue-to-PR orchestration | PROVEN | Server, worker, state machine, and evidence gates are present |
| Durable run/job/attempt state | PROVEN | `docs/architecture/durable-control-plane.md`, Issue #421 evidence |
| Fake/demo adapters | PROVEN | Fake GitHub, SpecKit, OpenCode, and workspace adapters |
| Operator cockpit | PROVEN | Dashboard, runs, run detail, evidence, repositories, projects, evolution, settings, admin routes |
| Local voice output | DEMO | Browser Web Speech API; optional and local-only |
| Real adapters | GATED | Requires explicit mode, credentials, binaries, and safety configuration |
| Supervised Full Real Mode validation | PROVEN / GATED | Issue #308 is closed; this does not authorize unsupervised Real Mode or deployment |
| Heterogeneous worker control-plane boundary | PROVEN | [Issue #447 architecture](../architecture/architecture-after-consolidation.md) |
| Static public landing page | PROVEN | Source is deployed at the verified GitHub Pages URL |
| Operator readiness projection | PROVEN / GATED | Read-only `positron.operator-readiness.v1` endpoint and dashboard view; real execution remains safety-gated |

## Current quality contract

The required branch-protection contexts are `format-check`, `differential-lint`, `build`, `typecheck`, `unit-tests`, and `observability-config-check`. Run status is mutable and should be read from [GitHub Actions](https://github.com/Mueller-Systems-Lab/Positron/actions), not copied into a fixed badge count.

Use `npm test`, `npm run build`, `npm run typecheck`, and the relevant Playwright/route-smoke commands for a dated snapshot. The exact result for each Issue #211 run is recorded in its evidence and GitHub comments.

## Current issue state relevant to this document

- [#211](https://github.com/Mueller-Systems-Lab/Positron/issues/211) is historical repository polish/install/Pages work.
- [#308](https://github.com/Mueller-Systems-Lab/Positron/issues/308) is closed after supervised validation; unsupervised Real Mode remains gated.
- [#447](https://github.com/Mueller-Systems-Lab/Positron/issues/447) and its validation remainder #464 are closed historical portfolio work.
- [#482](https://github.com/Mueller-Systems-Lab/Positron/issues/482) is the active v0.2 operator-readiness slice.
- #250, #340, #416, #421, and #402 are closed historical work; they are references to evidence, not current backlog.

## Related living docs

- [Known Limitations](known-limitations.md)
- [Architecture](../architecture.md)
- [Security model](../security/security-model.md)
- [Getting Started](../getting-started/README.md)
