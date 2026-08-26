# Issue #211 — Agent / Worker Inventory

**Inventory date:** 2026-08-26
**Controller:** Positron run / OpenAI GPT-5
**DeepSeek usage:** 0

The execution environment exposes one active Codex controller and no callable subagent-spawn interface. The repository contains an OpenCode `issue-orchestrator` configuration, but its privileged GitHub mutation permissions are denied. Required responsibilities are therefore executed as explicit, evidence-producing delegated workstreams by the controller; no ceremonial or fabricated agent calls are recorded.

| AGENT / WORKSTREAM | ROLE | PROVIDER | MODEL | TRUST TIER | AVAILABLE | ALLOWED | ASSIGNED TASK | OUTPUT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Controller / Orchestrator | single control authority | OpenAI | GPT-5 | L0 | yes | yes | scope, sequencing, GitHub state, exact-head decisions | this run + issue ledger |
| Repository Reality Audit | current-main and metadata audit | OpenAI | GPT-5 | Tier 0/L1 | delegated | yes | inspect current main, GitHub state, runtime/config drift | `repository-reality.md` |
| Repository Hygiene | root/docs/artifact classification | OpenAI | GPT-5 | L1 | delegated | yes | classify cleanup candidates without blind deletion | `repository-cleanup-manifest.md` |
| Architecture | quickstart boundary and controller invariants | OpenAI | GPT-5 | L1 | delegated | yes | approve dedicated demo Compose design | `architecture-review.md` |
| Security | safe defaults, secrets, action permissions | OpenAI | GPT-5 | L1 | delegated | yes | inspect scripts, Compose, site and workflow | `security-review.md` |
| DevEx / Installer | one-command local/demo UX | OpenAI | GPT-5 | L1 | delegated | yes | implement and test quickstarts/doctor | PR B evidence |
| Docker / Infrastructure | container topology and Compose | OpenAI | GPT-5 | Tier 1 | delegated | yes | reproduce legacy path and build demo path | Docker evidence |
| Frontend / Landing Page | static site implementation | OpenAI | GPT-5 | L1 | delegated | yes | build `site/` | PR C site |
| UX / Accessibility | keyboard, semantics, focus, contrast, motion | OpenAI | GPT-5 | L1 | delegated | yes | review landing page | accessibility evidence |
| Visual QA / Playwright | screenshot and browser verification | OpenAI | GPT-5 | Tier 1 | delegated | yes | capture/inspect current views and site | screenshot/site evidence |
| Documentation | README/status/install synchronization | OpenAI | GPT-5 | L1 | delegated | yes | update living docs and claim mapping | PR A/PR C docs |
| GitHub / Pages Integration | workflow/settings/deployment | OpenAI | GPT-5 | Tier 0 + owner-authorized mutation | delegated | yes | official Pages workflow and post-merge enablement | Pages evidence |
| Test / Tooling | relevant quality gates and scans | OpenAI | GPT-5 | Tier 1 | delegated | yes | run tests, link/secret/artifact checks | test evidence |
| Integration | cross-PR merge/rebase checks | OpenAI | GPT-5 | L1 | delegated | yes | verify each frozen head and main refresh | PR ledger |
| Release / Packaging Review | release boundary and package truth | OpenAI | GPT-5 | L1 | delegated | yes | keep draft unpublished and no runtime release | release review |
| Governance / Policy | scope, isolation, no-main/no-secret policy | OpenAI | GPT-5 | L0/L1 | delegated | yes | review portable path assumption and gates | governance evidence |
| Independent Final Verifier | fresh final inspection | OpenAI | GPT-5 | L0/L1 | delegated | yes | independently check acceptance matrix | final evidence |
| Research Agent | official external Pages guidance | OpenAI | GPT-5 | Tier 0 | delegated | yes | verify official action families/pins | Issue comment + claims |
| `issue-orchestrator` configured worker | repository-configured agent | OpenCode config | model unspecified | policy-denied GitHub mutation | yes (config only) | limited | configuration inventory only; not invoked for writes | `.opencode/opencode.json` audit |
| DeepSeek agents | forbidden by owner scope | any | DeepSeek | forbidden | no | no | no task | `DEEPSEEK_AGENT_USAGE=0` |
| Paperclip / OpenClaw / quarantined external agents | forbidden/quarantined by `AGENTS.md` | external | unspecified | forbidden/quarantined | no | no | no task | not enabled |

## Participation note

Each allowed responsibility above has an assigned evidence output or an auditable implementation activity. The environment did not provide callable independent agents, so role separation is documented as workstreams executed under the single Positron controller; this preserves the architecture invariant and avoids claiming independent review where none occurred.

