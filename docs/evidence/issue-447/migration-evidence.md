# Issue #447 — Migration Evidence

## Source observations

The following read-only local source checkouts were inspected at the recorded
heads:

| Source | Observed evidence |
|---|---|
| Morpheus_workflow `3dd891f` | `adapter/`, exported n8n workflows, contract schemas, recovery/evidence tests and README claims around OpenCode, n8n, Proxmox, idempotency and restart behavior |
| ghiw-system-of-record `3be86e9` | `architecture/`, `local_llm/`, `builder/`, `workflows/`, evaluation corpus, recovery/security docs and deterministic tests |
| n8n provisioning snapshots `849043c` / `91d9de6` | Provisioning, trusted runner, rollback and authenticated-readiness evidence; exact issue name is not currently resolvable |
| ai_coding_orchestrator `2c9f669` | Multi-agent controller, permission engine, state machine, observability and graph workflow implementation |
| universal-ai-test-harness `1eace0c` | Deterministic QA profiles, evidence output, safe defaults, local-only policy and test lifecycle |
| llm_benschmark `491ffd8` | Reasoning/tool/MCP/security/agentic runners, category scoring and statistical comparisons |
| OpenCode_GitHub_Issue_Worker `9e94657` | Single-issue polling worker, strict env parser, OpenCode permission config and systemd hardening |
| OpenCode-Hermes-Agent-Bootstrap `5956846` | Capability resolver, dry-run/apply/rollback bootstrap and separate OpenCode/Hermes installation surface |
| Neutrino `e89ff1c` | Default-deny policy, human authorization, evidence oracle/diff and validation recipe tests |
| OpenCode-Agenten-Oekosystem `82a38b6` | Explicit archive notice redirecting active bootstrap development to Hermes; retained as OCAE companion evidence |

The remaining named sources are recorded as `UNKNOWN` in the inventory because
no safely attributable local checkout or current authenticated remote was
available in this run. No implementation is inferred from their names.

## Native Positron mapping

| Legacy capability | Native Positron boundary | Evidence |
|---|---|---|
| Durable orchestration and recovery | Run → Queue → Job → Attempt, leases, fencing, idempotency and `durable-run` | `docs/architecture/durable-control-plane.md`; `packages/control-plane/src/durable-run.ts` |
| Deterministic QA verdicts | Verification contract and failure classification | `packages/control-plane/src/verification.ts`; `packages/control-plane/src/failure.ts` |
| Benchmark execution/evaluation | Benchmark Rudolph and compute-matched evaluation contracts | `packages/benchmark-rudolph/`; `packages/control-plane/src/evaluation.ts` |
| Evidence portfolio | Append-only evidence portfolio updater and evidence index | `packages/shared/src/evidence-portfolio/`; `docs/status/evidence-index.md` |
| OpenCode worker execution | OpenCode adapter with bounded command runner and redacted evidence | `packages/opencode-adapter/`; `packages/sandbox/src/command-runner.ts` |
| Mission-loop fresh context | Attempt identity, retry delta policy and recovery boundary | `packages/control-plane/src/retry-policy.ts`; `packages/control-plane/src/durable-run.ts` |
| Workflow mutation safety | Typed request contract plus fail-closed evaluator | `packages/control-plane/src/workflow-mutation-policy.ts`; `packages/control-plane/src/__tests__/workflow-mutation-policy.test.ts` |
| Default deny and approval | Sandbox command policy, run-state gates, approval/evidence contracts | `packages/sandbox/`; `packages/run-state/`; `packages/shared/src/human-approval-pack.ts` |

## Non-copy controls

- No `.env`, token, API key, provider credential, runtime database, SSH
  material or unredacted prompt/model output was copied.
- No source test was executed in a mode that could call an external model;
  DeepSeek agent usage is zero.
- Historical DeepSeek strings present in legacy evidence were treated as
  source evidence only and not activated, copied into runtime, or used for
  review.
- Proxmox and n8n remain future adapter targets; this PR performs no live
  deployment or workflow mutation.
