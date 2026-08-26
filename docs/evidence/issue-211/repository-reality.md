# Issue #211 — Repository Reality Audit

**Audit date:** 2026-08-26
**Audited base:** `a7a33596d45343eb0bf4a429ac6d487fc9fd8b61`
**Auditor:** Repository Reality delegated workstream (controller, OpenAI GPT-5)
**Authority:** execution-time `origin/main` and GitHub API

## GitHub state

| Field | Current truth |
| --- | --- |
| Repository | `xxammaxx/Positron` |
| Visibility | public |
| Default branch | `main` |
| Main SHA | `a7a33596d45343eb0bf4a429ac6d487fc9fd8b61` |
| Description | Evidence-gated GitHub issue-to-PR orchestrator for supervised autonomous coding workflows |
| Homepage | unset (`null`) |
| Pages | disabled (`has_pages=false`) |
| Topics | 12 relevant topics; no change assumed without evidence |
| Branch protection | enabled; six required contexts: format-check, differential-lint, build, typecheck, unit-tests, observability-config-check |
| Open issues | #211 and #308 |
| Open PRs | none at audit time |
| Draft releases | one unpublished `v0.2.0-rc.1` draft |

## Version truth

- **Package version:** `0.1.0` in the private root package manifest. This is the package metadata truth, not a published release claim.
- **Product status:** pre-release / active development. The repository has fake/demo capability and gated integrations, but no evidence justifies a single canonical released product version.
- **Release status:** `v0.2.0-rc.1` exists as an unpublished GitHub draft. It must not be presented as released or published.
- **Action:** living docs must remove operationally meaningless version badges. Dated release/changelog/evidence files remain historical records.

## Runtime and install truth

- Server defaults to fake GitHub, SpecKit, and OpenCode adapters when their mode variables are absent.
- Push and merge are disabled by default; the merge kill switch is intended to stay enabled.
- The existing `docker-compose.yml` requires host interpolation for `REDIS_PASSWORD` and `POSITRON_ADMIN_TOKEN`.
- The existing Compose file also assumes host OpenCode and SpecKit paths even when fake modes are selected.
- Clean legacy reproduction on this machine: `docker compose config` exits `15` before startup with `REDIS_PASSWORD` missing.
- A dedicated demo Compose path is therefore required; it will not alter the advanced Compose path.

## UI route truth

The current web application defines these routes: `/`, `/runs`, `/runs/:id`, `/evidence`, `/projects`, `/repos`, `/evolution`, `/settings`, `/admin`, plus a not-found route. Screenshots may only claim views that load successfully in the fresh demo run.

## Living documentation drift

The following current-facing drift was found and is in scope for correction:

- README has a stale `v0.2.0-rc.1` badge, fixed test totals, and an unavailable video path.
- `.env.example` has a misleading `Positron v3.0` heading, a token-shaped placeholder, and `POSITRON_MERGE_KILL_SWITCH=false`, conflicting with the intended safety boundary.
- `docs/status/current-capabilities.md` and `docs/status/known-limitations.md` contain fixed historical counts and references to closed #340/#416 work as if still open.
- `docs/install/windows-local-installer.md` says the repository is private, while GitHub reports it public.
- `CHANGELOG.md`, release notes, benchmarks, audits, and dated evidence contain historical numbers and issue states; they are not rewritten as part of living-doc correction.

## Artifact hygiene

Tracked current screenshot files exist under `docs/screenshots/`; they are historical and will not be silently relabeled as fresh evidence. Generated runtime artifacts are ignored by `.gitignore` (`.env`, databases, reports, traces, videos, logs, build output). No history rewrite is authorized.

## Agent and governance observations

- Positron remains the single controller authority in repository architecture and policy.
- Local `.opencode/opencode.json` exposes only the issue-orchestrator configuration and denies privileged GitHub mutation commands to that agent.
- No separate current worker-agent definition directory was found in `.opencode/` or `.specify/`; role participation is recorded in the companion agent inventory rather than fabricated as independent agents.
- DeepSeek is forbidden for this run and was not used.

