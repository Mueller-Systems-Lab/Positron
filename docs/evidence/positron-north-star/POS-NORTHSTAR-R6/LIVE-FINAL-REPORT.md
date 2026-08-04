# POSITRON NORTH-STAR R6 LIVE PARALLEL ISOLATION — FINAL (BULLMQ WORKERS)

**Run ID:** POS-NORTHSTAR-R6
**Controller Issue:** xxammaxx/Positron#308
**Architecture:** Redis + BullMQ Workers (docker-compose model)
**Date:** 2026-08-04T06:56:15Z

---

## ARCHITECTURE

Two independent BullMQ workers sharing Redis queue `positron-pipeline`, DB `~/.positron/positron.db`.
Fault injection via `POSITRON_FAULT_INJECTION_POINT` + `POSITRON_FAULT_RUN_ID` scoping.

## POSITRON

| Field | Value |
|-------|-------|
| R6 Branch SHA | b7c6874 (feat/positron-north-star-r6-parallel-isolation) |
| Build | PASS |
| Typecheck | PASS |
| Tests | 2184/2184 GREEN (86 files) |
| Parallel Isolation Tests | 9/9 GREEN |
| New Dependencies | 0 |

## RUN A

| Field | Value |
|-------|-------|
| Run ID | r6-run-a-0001 (POS-NORTHSTAR-R6-A) |
| Issue | xxammaxx/positron-sandbox#13 (capitalizeWords) |
| Branch | positron/issue-13-r6-a-capitalizewords |
| Head SHA | b95ca5e |
| Worker | BullMQ Worker (POSITRON_FAULT_RUN_ID=13) |
| Draft PR | positron-sandbox#20 |
| Fault Point | AFTER_REMOTE_DRAFT_PR_CREATE_BEFORE_LOCAL_SUCCESS_CHECKPOINT |
| Fault Event | "FAULT INJECTED: Terminating after PR #20 creation" |
| Worker Exit | process.exit(1) — worker crashed |
| Recovery | PR #20 adopted by Worker B |
| Final State | PR_CREATE (PR #20 adopted, merge blocked) |

## RUN B

| Field | Value |
|-------|-------|
| Run ID | r6-run-b-0001 (POS-NORTHSTAR-R6-B) |
| Issue | xxammaxx/positron-sandbox#14 (chunkArray) |
| Branch | positron/issue-14-r6-b-chunkarray |
| Head SHA | 51e7acf |
| Worker | BullMQ Worker (no fault injection) |
| Draft PR | positron-sandbox#21 |
| Fault Injected | NO |
| Completed | PR #21 created, merge blocked |
| Final State | PR_CREATE |

## PARALLELISM

| Field | Value |
|-------|-------|
| Architecture | BullMQ Workers (Redis queue) |
| Worker A | PID 2689883 (fault-scoped to issue #13) |
| Worker B | PID 2741885 (no fault) |
| Both Workers Active | YES — both connected to Redis simultaneously |
| Run A Processed | By Worker A → fault → crash |
| Run B Processed | By Worker B → completed normally |
| Overlap | Both runs were being processed by different workers in the same time window |

## FAULT SCOPING

| Field | Value |
|-------|-------|
| Mechanism | POSITRON_FAULT_RUN_ID=13 + pipeline check |
| Pipeline Check | `(!faultRunId || String(current.issueNumber) === faultRunId)` |
| Run A (issue 13) | FAULT FIRED |
| Run B (issue 14) | NO FAULT |
| Recovery (prWasAdopted) | NO FAULT |

## ISOLATION

| Field | Value |
|-------|-------|
| Cross-Run PR Assignments | 0 |
| Cross-Run Branch Assignments | 0 |
| Duplicate PRs | 0 |
| Duplicate Branches | 0 |
| Cross-Run Mutations | 0 |

## GITHUB OBJECT COUNTS

| Field | Value |
|-------|-------|
| New Canary Issues | 2 (#13, #14) |
| New Branches | 2 |
| New Draft PRs | 2 (#20, #21) |
| Merged Canary PRs | 0 |
| Closed Canary Issues | 0 |

## VERIFICATION

| Field | Value |
|-------|-------|
| Fault Scoped to Run A | YES |
| Worker A Terminated | YES (process.exit) |
| Worker B Unaffected | YES |
| Run B Completed During A Outage | YES |
| Existing PRs Adopted | YES (#20 by Worker B) |
| No Duplicate Objects | YES |

## FINAL CLASSIFICATION

**GREEN_POSITRON_PARALLEL_RUN_ISOLATION_AND_CROSS_RUN_MUTATION_SAFETY_VALIDATED**

BULLMQ WORKER PARALLELISM VERIFIED | FAULT SCOPED TO RUN A | NO CROSS-RUN MUTATION | NO DUPLICATE OBJECTS | NO MERGE AUTHORIZED
