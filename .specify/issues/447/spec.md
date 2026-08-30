# Issue #447 — Portfolio Consolidation Specification

## Status

Drafted from the 2026-08-30 reality refresh on `origin/main`
(`2b1b1c95244fdb947ee9c09ccd1626c19b51e5d0`). No legacy repository is modified
by this specification.

## Goal

Make Positron the canonical governance, evidence, durable orchestration and
policy/control plane around heterogeneous coding agents. External workers and
systems remain adapters; they do not own Run, Queue, Job, Attempt, approval,
evidence, retry, promotion or GitHub mutation authority.

## In scope

1. Inventory and classify all 20 source repositories named by #447, including
   inaccessible, renamed, superseded and local-only sources.
2. Account for unique implementation, test, evidence, security and document
   assets without copying secrets or runtime-only state.
3. Preserve the high-value n8n/OpenCode/Proxmox, workflow-integrity, QA,
   benchmark, browser-repair, mission-loop and governance concepts as native
   Positron capabilities, adapters, fixtures, tests or references.
4. Add a fail-closed typed workflow-mutation contract for future n8n adapters;
   this contract is evaluated by Positron and grants no external controller
   authority.
5. Publish the Living Truth Mirror, architecture diagrams, provenance,
   retirement-readiness matrix and product positioning.

## Out of scope

- Archiving, deleting, transferring or changing any source repository.
- Copying credentials, `.env` files, provider keys, runtime databases or
  unredacted execution traces.
- Enabling unsupervised Real Mode, deploying, releasing or merging.
- Using DeepSeek or paid model calls.
- Importing a second controller, editor, foundation model or company/product
  semantics.
- Treating OpenCode-Agenten-Oekosystem as Positron runtime; it remains the
  companion OSS distribution/governance funnel.

## Acceptance criteria

- All 20 named sources have one primary disposition and an explicit evidence
  or access status.
- Each required high-value asset is absorbed, adapted, reimplemented,
  referenced or explicitly rejected with rationale.
- `positron.workflow-mutation.v1` validates provenance and fingerprints and
  fails closed on stale baselines, missing approval and deletion.
- Deterministic tests cover allowed, stale, approval, deletion, secret-like
  provenance and malformed-request paths.
- Architecture documentation proves `NEW_CONTROL_PLANE_COUNT = 0` and the
  OCAE companion boundary.
- Retirement readiness is bounded and no source repository is mutated.
- Required local gates and the six protected-branch CI checks are green on the
  exact final head before owner merge authorization is requested.

## Safety invariants

`POSITRON = CONTROLLER`, `LLMs = WORKERS`, `DEEPSEEK_AGENT_USAGE = 0`,
`PAID_MODEL_CALLS = 0`, `SECRETS_COPIED = 0`, and
`NEW_CONTROL_PLANE_COUNT = 0`.
