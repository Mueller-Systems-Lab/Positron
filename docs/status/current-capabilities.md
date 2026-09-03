# Current Capabilities

**Status date:** 2026-09-01
**Baseline:** `9ffff264a89350016ea9b8c8fe6a4dee6829f07e`
**Product status:** v0.3.0 release candidate; installed supervised onboarding is implemented and undergoing final release qualification

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
| Install/setup doctor | PROVEN / GATED | Read-only `scripts/doctor.sh --demo|--supervised [--json]`; demo and supervised prerequisites remain separate |
| Installed supervised configuration | RELEASE CANDIDATE | `positron configure supervised` stores `positron.supervised-config.v1`; explicit `--supervised` lifecycle delegates to the existing advanced Compose |

## Current quality contract

The required branch-protection contexts are `format-check`, `differential-lint`, `build`, `typecheck`, `unit-tests`, and `observability-config-check`. Run status is mutable and should be read from [GitHub Actions](https://github.com/Mueller-Systems-Lab/Positron/actions), not copied into a fixed badge count.

Use `npm test`, `npm run build`, `npm run typecheck`, and the relevant Playwright/route-smoke commands for a dated snapshot. The exact result for each Issue #211 run is recorded in its evidence and GitHub comments.

## Current issue state relevant to this document

- [#211](https://github.com/Mueller-Systems-Lab/Positron/issues/211) is historical repository polish/install/Pages work.
- [#308](https://github.com/Mueller-Systems-Lab/Positron/issues/308) is closed after supervised validation; unsupervised Real Mode remains gated.
- [#447](https://github.com/Mueller-Systems-Lab/Positron/issues/447) and its validation remainder #464 are closed historical portfolio work.
- [#482](https://github.com/Mueller-Systems-Lab/Positron/issues/482) delivered the operator-readiness slice.
- [#490](https://github.com/Mueller-Systems-Lab/Positron/issues/490) delivered the v0.2 stable one-command installer.
- [#491](https://github.com/Mueller-Systems-Lab/Positron/issues/491) tracks installed supervised onboarding and release qualification.
- #250, #340, #416, #421, and #402 are closed historical work; they are references to evidence, not current backlog.

## Related living docs

- [Known Limitations](known-limitations.md)
- [Architecture](../architecture.md)
- [Security model](../security/security-model.md)
- [Getting Started](../getting-started/README.md)
