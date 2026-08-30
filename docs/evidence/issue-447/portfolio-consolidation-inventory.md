# Issue #447 — Portfolio Consolidation Inventory

Date: 2026-08-30 · Baseline: `2b1b1c95244fdb947ee9c09ccd1626c19b51e5d0`

## Classification vocabulary

`CURRENT` means a readable local checkout was inspected. `UNKNOWN` means the
named source could not be resolved in the current local roots or authenticated
remote probe. `SUPERSEDED` means Positron already owns the capability. A
disposition is the one primary action for the repository; asset-level exceptions
are recorded in [the matrix](asset-disposition-matrix.md).

## Repository inventory

| Repository | Current state / default / activity | Languages | Architecture role | Product/runtime/test/evidence/security/doc value | Positron overlap | Primary action | Migration / rejection rationale | Retirement ready |
|---|---|---|---|---|---|---|---|---|
| `klarstart` | UNKNOWN; default/activity unavailable | UNKNOWN | Unknown legacy product | Unknown; no contents available | Unknown | REFERENCE | Access/source identity must be supplied before asset claims; no code copied | NO |
| `klarstart_001` | UNKNOWN; default/activity unavailable | UNKNOWN | Unknown legacy variant | Unknown; no contents available | Unknown | REFERENCE | Same validation requirement; absence is recorded, not inferred as obsolete | NO |
| `klarstart_002` | UNKNOWN; default/activity unavailable | UNKNOWN | Unknown legacy variant | Unknown; no contents available | Unknown | REFERENCE | Same validation requirement; no implementation or evidence copied | NO |
| `_klarstart_` | UNKNOWN; default/activity unavailable | UNKNOWN | Unknown legacy variant | Unknown; no contents available | Unknown | REFERENCE | Same validation requirement; no implementation or evidence copied | NO |
| `Morpheus_workflow` | CURRENT local checkout `3dd891f`; `feat/canonical-project-continuation`; active 2026-08-30 | Python, JSON, n8n | External n8n/OpenCode/Proxmox execution and recovery | Runtime integration, adapter fixtures, recovery evidence, protected workflow checks and operational docs | Durable Run/Job/Attempt and policy are Positron-owned; external runtime is not | ADAPT | Preserve contracts/evidence references; implement only the safe workflow-mutation boundary | NO |
| `ghiw-system-of-record` | CURRENT local checkout `3be86e9`; `main`; active 2026-08-20 | Python, JSON | n8n/GHIW registry, native OpenCode plan/build and provider broker | Registry authority, builder verification, recovery, evaluation corpus and security boundaries | Positron owns source-of-truth lifecycle; GHIW runtime remains external | ADAPT | Map registry/verification/recovery patterns to adapters; never copy provider credentials or runtime DB | NO |
| `n8n-blueprint-workflow` | CURRENT lineage represented by two local `n8n-blueprint-provisioning-runtime-*` snapshots; exact named remote unresolved | Python, JSON, n8n | Provisioning and blueprint integrity | Fail-closed mutation, protected workflow, rollback and provenance patterns | Positron policy/evidence gates supersede controller behavior | ADAPT | New workflow mutation contract; direct workflow controller rejected | NO |
| `ai_coding_orchestrator` | CURRENT local checkout `2c9f669`; `main`; active 2026-06-05 | TypeScript, Bun | Duplicate multi-agent controller | Permission, checkpoint and observability concepts | Fully duplicated by Positron control plane and adapters | REJECT_AS_OBSOLETE | Preserve only security/permission ideas already represented by sandbox policy | NO |
| `universal-ai-test-harness` | CURRENT local checkout `1eace0c`; hardening branch; active 2026-07-19 | Python | QA bootstrap and deterministic verdict producer | QA profiles, evidence layout, reproducible checks and failure fixtures | Existing verification/evidence portfolio and benchmark package supersede runtime | ABSORB | Capability already native; provenance recorded, no duplicate QA runner | NO |
| `llm_benschmark` | CURRENT local checkout `491ffd8`; `main`; active 2026-05-29 | Python, JSON | Model/worker evaluation | Reasoning/tool/MCP/security/agentic categories, datasets, evaluators and statistics | Existing evaluation contracts and `benchmark-rudolph` own execution boundary | ADAPT | Map categories and statistical outputs to evidence contracts; no benchmark controller | NO |
| `agentic-browser-repair-kit` | UNKNOWN; not present in inspected local roots; exact remote unresolved | UNKNOWN | Browser repair workload | Unknown source-specific fixtures/contracts | Positron E2E/browser workload surface is the target | REFERENCE | Requires source checkout before migration; no browser automation authority imported | NO |
| `mission-driven-agent-loop` | UNKNOWN; not present in inspected local roots; exact remote unresolved | UNKNOWN | Stateless mission-loop controller | Concept is valuable, implementation is not available | Durable attempts/retry/fresh worker boundaries supersede controller | REIMPLEMENT | Re-express fresh-context/retry concepts through existing attempts and retry policy | NO |
| `OpenCode_GitHub_Issue_Worker` | CURRENT local checkout `9e94657`; `main`; active 2026-05-18 | Python, shell, Markdown | Single-issue OpenCode worker | Strict env parser, version check, systemd hardening and issue evidence | Positron GitHub/OpenCode/sandbox adapters supersede controller | REIMPLEMENT | Security patterns are already native; worker lifecycle is not imported | NO |
| `OpenCode-Hermes-Agent-Bootstrap` | CURRENT local checkout `5956846`; `main`; active 2026-07-27 | JavaScript, Markdown | OpenCode/Hermes discovery and installation | Capability resolver and dry-run bootstrap | Belongs to companion distribution layer, not Positron control plane | KEEP_SEPARATE | Keep as installation/governance companion; no runtime authority imported | NO |
| `Positron-Auto-Growth-System` | UNKNOWN; not present in inspected local roots; exact remote unresolved | UNKNOWN | Product-growth semantics | Not evaluated because source unavailable | Product semantics are out of scope | REFERENCE | Validate only if source identity is supplied; no growth controller imported | NO |
| `positron-e2e-test` | UNKNOWN; not present in inspected local roots; exact remote unresolved | UNKNOWN | External E2E workload | Unknown source-specific tests/fixtures | Existing `e2e/` and Playwright contracts overlap | REFERENCE | No unverified tests copied; map future fixtures through normal E2E suite | NO |
| `positron-external-test` | UNKNOWN; not present in inspected local roots; exact remote unresolved | UNKNOWN | External integration workload | Unknown source-specific evidence | Existing integration and adapter tests overlap | REFERENCE | Requires source access; no external runtime path imported | NO |
| `positron-sandbox` | UNKNOWN as named source; current protected sandbox is separate from this issue | UNKNOWN | Canary target, not controller | Existing canary evidence is retained in Positron docs | Sandbox/approval policy is Positron-owned | REJECT_AS_OBSOLETE | No sandbox repository code or remote evidence is copied into controller | NO |
| `zero-human-company-control-plane` | UNKNOWN; exact source unresolved; Paperclip-named material was not inspected | UNKNOWN | Generic governance concept | Generic safety/evidence ideas only | Control plane is already Positron-owned | REIMPLEMENT | Re-express only generic patterns in existing gates; product/company semantics rejected | NO |
| `Neutrino` | CURRENT local checkout `e89ff1c`; `main`; active 2026-07-10 | Python | Policy/evidence safety library | Default-deny, approval, evidence oracle/diff, validation recipes and threat-model ideas | Positron sandbox/control-plane gates supersede standalone runtime | REIMPLEMENT | Preserve concepts in Positron policy and evidence contracts; no Python runtime copied | NO |

## Source-state notes

- Local checkouts contain unrelated uncommitted work; they were read only.
- Exact remote probes resolved `xxammaxx/Morpheus_workflow`; the remaining
  named sources were not safely attributable to a current accessible remote
  from this run. This is an explicit `UNKNOWN`, not a deletion claim.
- No source repository was archived, deleted, branch-deleted, rewritten or
  modified.
