# Positron Canonical Migration Manifest

Manifest contract: `positron.migration-manifest.v1`

This document records the deliberately reconciled baseline. The source
repository remains historical provenance and is not rewritten or retired by
this migration.

## Source

- Repository: `https://github.com/Mueller-Systems-Lab/Positron`
- Observed source `main`: `cd6ab5a945864549b8ccdadb79cea0b63f6583d0`
- Source repository mutation: `NO`
- Local foreign repository preserved: `YES`

## Material subsystem decisions

| Source path / area | Classification | Target / action | Validation |
| --- | --- | --- | --- |
| `apps/server` | KEEP | lifecycle API and controller boundary; add canonical project-entry routes | build, server tests |
| `apps/web` | KEEP | operator cockpit; add Existing Repository / Blueprint onboarding | web typecheck and focused tests |
| `packages/control-plane` | KEEP | durable run/job/attempt authority and evidence gates | control-plane tests |
| `packages/github-adapter` | KEEP | read/write capability adapter; repository creation is explicit and private by default | adapter tests, build |
| `packages/speckit-adapter` | KEEP | detection/initialization and Specify/Plan/Tasks artifact flow | adapter tests |
| `packages/opencode-adapter` | KEEP | worker/provider adapter behind controller policy | adapter tests |
| `packages/run-state` | KEEP | durable state and project-entry registration | schema/build tests |
| `packages/sandbox` | KEEP | bounded workspace execution and safety policy | sandbox tests |
| `packages/shared` | KEEP | contracts, evidence, redaction, credential references | shared tests |
| `packages/tool-gateway` | KEEP | bounded tool capability boundary | gateway tests |
| `packages/worker-pipeline` | KEEP | stage execution under control-plane gates | pipeline tests |
| `packages/benchmark-rudolph` | EXTERNALIZE | retain as harness-quality support, not product authority | repository inventory |
| `docs/` and `scripts/` | KEEP | canonical contract, evidence, architecture, and local gates | manifest and boundary gate |
| `site/` and landing assets | HISTORICAL | retained as repository presentation; not lifecycle authority | source inventory |
| voice/UI experiments | DROP | no material mapping to the software-delivery lifecycle | product contract |
| generic skill/learning experiments | EXTERNALIZE | only bounded evidence-based harness candidates remain | P5 reconciliation |
| provider configuration | REWORK | provider/model discovery and qualification remain controller-owned | provider route and qualification tests |
| observability dashboards | REWORK | default surface is Projects, Runs, Providers, Evidence, Settings; deep telemetry is advanced | UI route inventory |
| old source history and open PRs | HISTORICAL | preserve URL, refs, SHAs, and classifications; do not transplant blindly | Git refs / PR inventory |

## Open source PR reconciliation

| PR | Observed head | Classification | Decision |
| --- | --- | --- | --- |
| #499 | `3a2832da2d3353472ff33f71e9633b8986eaaab4` | SUPERSEDED | superseded by #504; do not merge |
| #500 | `8aec5f69b972be634b622c57f3077aeb3968bfcb` | HISTORICAL | release-hardening provenance only |
| #503 | `670ce93199cee0e004f9cce8e1388f1fc30c6ee7` | KEEP | least-privilege change is relevant, but port only after independent validation |
| #504 | `416d052efe52de17bc6e972d69503eae662d4bca` | KEEP | successor to #499; source provenance retained |

The source default branch and these PR head SHAs were observed from local Git
and GitHub refs. PR merge/review state could not be refreshed when the GitHub
API became unavailable; this is an evidence limitation, not a claim of merge.

## Machine-readable companion

See [`docs/migration/manifest.json`](docs/migration/manifest.json).
