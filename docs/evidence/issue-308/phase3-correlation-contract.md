# Issue #308 — Phase 3 correlation contract

Generated: 2026-08-28.

The current durable schema exposes these authoritative execution identities:

- `runId` — `runs.id`
- `queueItemId` — `cp_queue.queue_item_id`
- `jobId` — `cp_jobs.job_id`
- `attemptId` — `cp_attempts.attempt_id`
- `workspaceKey` — `cp_workspace_locks.workspace_key`
- `attemptLeaseOwnerId` and `attemptLeaseGeneration` — current attempt fence
- `workspaceLockOwnerId` and `workspaceLockGeneration` — current workspace fence
- `providerReservationId` — `cp_provider_reservations.reservation_id`
- `idempotencyKey` — durable `cp_idempotency.idem_key`

There is no current `approval_request_id` column or durable approval-request
record, so none is invented here. The new run-bound envelope binds exactly the
identities above and the existing effect binding. The canonical pipeline
creates a dedicated `stage3-pilot` Job/Attempt and persists the bounded result
before entering `PR_CREATE`; recovery cannot fall back to the generic writer.

No Phase 3 values were frozen in this run: `RUN_IDENTITY`, `JOB_IDENTITY`,
`ATTEMPT_IDENTITY`, lease identities, provider reservation, idempotency key,
approval expiry, and approval fingerprint are all `NOT_CREATED`.
