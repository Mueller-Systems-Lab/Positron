# Issue #447 — Consolidation Plan

## Baseline

- Repository: `Mueller-Systems-Lab/Positron`
- Base: `origin/main` at `2b1b1c95244fdb947ee9c09ccd1626c19b51e5d0`
- Branch: `positron/issue-447-portfolio-consolidation`
- Open issue/PR refresh: only #447 open; no primary-repository PRs open.
- Existing unrelated workspace changes were preserved in a named stash and are
  not part of this branch.

## Vertical slices

### Slice 1 — Inventory and architecture map

Write the 20-source inventory, asset disposition matrix and frozen topology.
Resolve local/source commit evidence and mark unknown sources as needing
validation instead of guessing.

### Slice 2 — QA, evidence and benchmark convergence

Map universal-ai-test-harness and llm_benschmark assets to the existing
verification contract, evidence portfolio, `benchmark-rudolph`, compute-matched
evaluation and KPI surfaces. Preserve useful fixtures as references; do not
create a benchmark controller.

### Slice 3 — Workflow mutation safety

Add `positron.workflow-mutation.v1` and a deterministic control-plane policy
function. Adapt the n8n blueprint gatekeeper pattern behind the policy boundary;
stale baselines, missing protected-workflow approvals, secret-like provenance
and deletion fail closed.

### Slice 4 — Runtime and recovery provenance

Map Morpheus/GHIW runtime-provenance, OpenCode, Proxmox and restart/recovery
evidence to existing Run/Job/Attempt, idempotency, lease, fencing and sandbox
contracts. Keep credentials and deployment state out of Positron.

### Slice 5 — Browser, mission and companion boundaries

Map browser repair and mission-loop concepts to existing E2E/adapter/attempt
surfaces. Mark unavailable source trees as validation blockers. Document OCAE as
the separate companion OSS distribution layer.

### Slice 6 — Retirement and release gate

Publish migration evidence, retirement-readiness and final report. Run focused
tests, full local gates, secret/security/documentation checks, freeze the exact
head, create/update the PR and stop for owner merge authorization.

## Review gate

Review is performed only after tests and implementation are complete on a
frozen exact head. Findings are aggregated before any remediation batch; a new
head invalidates old exact-head review evidence.
