# POSITRON NORTH-STAR R6 LIVE PARALLEL ISOLATION — FINAL

**Run ID:** POS-NORTHSTAR-R6
**Controller Issue:** xxammaxx/Positron#308
**Architecture Tested:** Redis + BullMQ Workers (shared queue)
**Date:** 2026-08-04T17:49:29Z

---

## CORRECTED CLASSIFICATION

### AMBER_ISOLATION_AUDIT_REQUIRED

The operational core of the R6 run card was NOT executed. Two workers pulled jobs
from a single shared BullMQ queue — indistinguishable from sequential distribution.
No per-worker run scoping. No parallel start barrier. No seeded fault. DONE not reached.

Full gap analysis: `live-48-isolation-audit-gap.json`

---

## WHAT WAS PROVEN

| Capability | Status |
|-----------|--------|
| BullMQ workers process jobs from Redis queue | PASS |
| POSITRON_FAULT_RUN_ID scoping fires correctly | PASS |
| process.exit(1) terminates worker | PASS |
| Pipeline adopts existing PRs (idempotency) | PASS |
| No duplicate GitHub objects | PASS |
| 2184/2184 Positron tests | PASS |
| 9/9 isolation tests | PASS |

## WHAT WAS NOT PROVEN

| Capability | Gap |
|-----------|-----|
| True parallel run isolation | Single shared queue, no worker scoping |
| Fault isolation between workers | Both workers pulled from same queue |
| Recovery run-scoping | No POSITRON_RECOVERY_RUN_ID |
| DONE state reachable | Gates block merge without human |
| Isolation test falsifiability | No seeded fault executed |

## CANARY ARTIFACTS

| Run | Issue | Branch | PR | Fault |
|-----|-------|--------|-----|-------|
| A | #13 (capitalizeWords) | positron/issue-13-r6-a-capitalizewords | #20 | INJECTED |
| B | #14 (chunkArray) | positron/issue-14-r6-b-chunkarray | #21 | NONE |

## REQUIRED FOR GREEN

1. Implement POSITRON_RECOVERY_RUN_ID worker scoping
2. Start both workers BEFORE runs, with shared release barrier
3. Prove Worker B never claims Run A's job during A outage
4. Execute seeded fault → isolation tests must catch it
5. Configure gates to allow DONE state in canary context

## FINAL

| Item | State |
|------|-------|
| Issue #308 | OPEN |
| PR #420 | OPEN (DRAFT) |
| Canary PR #20 | OPEN, UNMERGED |
| Canary PR #21 | OPEN, UNMERGED |

Issue #308 / PR #420 / Canary PRs #20, #21 — all OPEN and UNMERGED.
