# Current Capabilities

**Status date:** 2026-08-26
**Baseline:** `a7a33596d45343eb0bf4a429ac6d487fc9fd8b61`
**Product status:** pre-release / active development

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
| Full productive Real Mode | DEFERRED | Validation issue #308 remains open; no production-readiness claim |
| Static public landing page | GATED | Source is delivered in `site/`; public availability follows Pages deployment evidence |

## Current quality contract

The required branch-protection contexts are `format-check`, `differential-lint`, `build`, `typecheck`, `unit-tests`, and `observability-config-check`. Run status is mutable and should be read from [GitHub Actions](https://github.com/xxammaxx/Positron/actions), not copied into a fixed badge count.

Use `npm test`, `npm run build`, `npm run typecheck`, and the relevant Playwright/route-smoke commands for a dated snapshot. The exact result for each Issue #211 run is recorded in its evidence and GitHub comments.

## Current issue state relevant to this document

- [#211](https://github.com/xxammaxx/Positron/issues/211) is the active repository polish/install/Pages track.
- [#308](https://github.com/xxammaxx/Positron/issues/308) remains open and unchanged by this issue.
- #250, #340, #416, #421, and #402 are closed historical work; they are references to evidence, not current backlog.

## Related living docs

- [Known Limitations](known-limitations.md)
- [Architecture](../architecture.md)
- [Security model](../security/security-model.md)
- [Getting Started](../getting-started/README.md)
