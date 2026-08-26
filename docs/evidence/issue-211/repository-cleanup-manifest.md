# Issue #211 — Repository Cleanup Manifest

**Rule:** every candidate is classified exactly once; no blind deletion. Historical evidence remains historically truthful.

| PATH / SCOPE | CLASSIFICATION | RATIONALE | REFERENCES | RISK |
| --- | --- | --- | --- | --- |
| `README.md` | UPDATE | current first-visit contract has stale counts/version/video claims | current app routes, package metadata, status docs | medium |
| `.env.example` | UPDATE | heading, placeholder, and kill-switch example conflict with safe defaults | server env reads, Compose, security docs | high |
| `docs/status/current-capabilities.md` | UPDATE | living status contains fixed historical totals and closed-work backlog | GitHub issue state, current tests | medium |
| `docs/status/known-limitations.md` | UPDATE | closed #340/#416 references are presented as current | GitHub API | medium |
| `docs/install/windows-local-installer.md` | UPDATE | says repository is private and predates quickstart | GitHub metadata, new installer path | medium |
| `docs/architecture.md`, `docs/blueprint-analysis.md` | UPDATE | link/terminology sync only; architectural history is retained | current durable control-plane docs | low |
| `CHANGELOG.md`, `docs/changelog/**` | KEEP | dated release history; numbers are historical evidence | file dates and release headings | low |
| `docs/release/**`, `docs/evidence/**`, `docs/audits/**`, `docs/benchmark/**`, `docs/diagnostics/**` | KEEP | canonical historical proof; do not rewrite for modern counts | existing evidence indexes | low |
| `docs/screenshots/**` | KEEP | historical screenshots are retained and clearly separated from fresh assets | README references audited | low |
| `docs/assets/screenshots/**` | UPDATE | add only freshly verified, privacy-reviewed current captures | screenshot acceptance criteria | medium |
| root prompt/reference files (`Meta-Prompt...`, `NEXT.md`, `RUNBOOK.md`, `STATUS.md`, `RUN_CARD*`, `POS-*`, `*NORTHSTAR*`, `Nicht gespeichertes Dokument 1.md`) | HUMAN_CONTEXT_REQUIRED | specialized historical/operator material may be useful, but move/delete requires owner context and reference audit | root tree and historical evidence links | high |
| `Blueprint.md` | KEEP | current architectural blueprint is a root-level contract/reference; no runtime dependency change | architecture docs and root tree | medium |
| `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md` | KEEP/UPDATE | repository presentation contract; update only if current forms are inadequate | GitHub metadata audit | low |
| `docs/install/**`, `docs/getting-started/**` | UPDATE | consolidate discoverability around the new quickstart without mass-moving stable evidence | install audit | medium |
| `*.webm`, `*.mp4`, traces, logs, DB/WAL/SHM, Playwright reports, `dist/`, coverage | KEEP/DELETE by tracked state | ignored/generated artifacts are not canonical; tracked files require per-path reference check before removal | `.gitignore`, artifact scan | high if blind |
| `.agent-worktrees/**` | KEEP (ignored) | local isolation area; never stage into PR | `AGENTS.md` | low |
| `.opencode/backups/**`, `.hermes/**`, `.agent-governance/**` | KEEP | governance/runtime evidence; not product cleanup targets in this issue | current governance inventory | medium |

## Decision

PR A is limited to living-doc updates and new issue evidence. Root miscellaneous prompt files and historical evidence are not deleted or mass-moved during this run because their canonical status and cross-links need owner context beyond repository presentation. This is an explicit `HUMAN_CONTEXT_REQUIRED` outcome, not a silent omission.

