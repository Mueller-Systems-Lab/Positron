# Issue #447 — Asset Disposition Matrix

Every row has one primary action. Existing Positron paths are named where a
capability is already absorbed; source code is not copied solely for volume.

| Source asset | Primary action | Positron owner / proof | Safety boundary |
|---|---|---|---|
| Morpheus n8n/OpenCode/Proxmox runtime path | ADAPT | `packages/control-plane`, `packages/opencode-adapter`, future external adapter; `docs/architecture/durable-control-plane.md` | No Proxmox credential, deployment recipe or independent lifecycle authority |
| Morpheus restart/recovery and failure evidence | REFERENCE | `packages/control-plane/src/durable-run.ts`, idempotency, lease and recovery tests | Evidence references only; runtime-only traces stay in source |
| GHIW registry/builder verification | ADAPT | Plan gate, verification contract and adapter boundary | Positron remains source of truth; no registry DB copied |
| GHIW provider broker/privacy contract | REFERENCE | `docs/security/security-model.md`, `docs/security/opencode-mcp-security-policy.md` | No provider keys, `.env` or model credentials copied |
| n8n protected-workflow mutation gate | ABSORB | `positron.workflow-mutation.v1` and `evaluateWorkflowMutation` | Stale baseline, missing approval, secret-like provenance and DELETE fail closed |
| n8n rollback/provenance fixtures | ADAPT | `docs/evidence/issue-447/migration-evidence.md` | No live n8n mutation or production workflow access |
| Universal QA profiles and deterministic verdicts | ABSORB | `packages/control-plane/src/verification.ts`, `packages/benchmark-rudolph`, evidence portfolio | Tool-measured verdicts only; no LLM-only pass |
| Universal QA evidence layout and failure fixtures | ABSORB | `packages/shared/src/evidence-portfolio`, contract tests and evidence index | Append-only evidence; path and secret guards remain active |
| LLM reasoning/tool/MCP/security/agentic categories | ADAPT | `packages/control-plane/src/evaluation.ts`, `packages/benchmark-rudolph` | Benchmark is a worker/evaluation input, never a controller |
| LLM datasets/evaluators/statistical comparison | REFERENCE | `docs/benchmark/rudolph-beacon/*`; mapping recorded, no corpus blob copied | No paid calls, no provider credentials, no unverified scores |
| Browser repair loop | REFERENCE | Existing Playwright/browser verification workload surface | Source unavailable; no browser agent or authority imported |
| Mission fresh-context semantics | REIMPLEMENT | Durable attempt identity, recovery boundary and retry policy | Each retry requires information gain; no blind loop |
| OpenCode issue-worker env parser/hardening | ABSORB | `packages/opencode-adapter`, `packages/sandbox`, secret manager tests | OpenCode remains worker; push/merge/release/deploy stay gated |
| OpenCode/Hermes bootstrap discovery | KEEP_SEPARATE | OCAE companion boundary in architecture docs | Installation layer cannot create Run/Job/Attempt authority |
| AI orchestrator multi-agent graph/controller | REJECT_AS_OBSOLETE | Positron durable control plane and scheduler | Zero second control plane |
| Klarstart variants | REFERENCE | Unknown-source register in inventory | No claim about unique assets without source access |
| External E2E/integration suites | REFERENCE | Existing `e2e/` and package integration suites | Future fixtures enter through normal test contracts |
| Positron sandbox target | REJECT_AS_OBSOLETE | Positron sandbox/approval packages and historical evidence | No target-repository code or remote mutations copied |
| Zero-human generic governance | REIMPLEMENT | Existing approval, evidence, security and autonomy docs | Paperclip/product semantics excluded; no source runtime inspected |
| Neutrino default-deny/evidence/diff ideas | REIMPLEMENT | Sandbox policy, contract validator and evidence gates | Standalone Python authority not imported |

## Required-asset outcome

The required high-value assets are either native already (`ABSORB`), bounded by
the new adapter contract (`ADAPT`), translated to existing durable concepts
(`REIMPLEMENT`) or retained as evidence pointers (`REFERENCE`). No asset creates
a new authority path.
