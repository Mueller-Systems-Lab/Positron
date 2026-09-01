# Issue 478 — Independent Review Record

Review date: 2026-09-01
Review scope: branch `positron/issue-478-runtime-budget-deadline-contract` against post-PR-477 `main` (`099d005d4b442200e83ac51d38f1db9ba51f007d`).

## Architecture review

Result: `CRITICAL=0`, `MAJOR=0`.

- The implementation extends the existing `run → job → attempt` path, `runCommand`, OpenCode adapter, V12 attempt persistence, and existing lease/state fencing.
- No second runtime database, scheduler, or state machine was introduced. The only schema change is additive V12 columns on `cp_attempts`.
- Child deadlines and limits are bounded by the remaining parent budget; retries consult the finite parent budget and `max_retries`.
- The contract fingerprint excludes generated IDs, audit timestamps, and absolute clock readings, while retaining policy and execution identity fields.
- Existing migration shape validation, terminal transition guards, and owner/generation fencing remain the authority for durable completion.

Evidence: `packages/shared/src/runtime-budget.ts`, `packages/control-plane/src/schema.ts`, `packages/control-plane/src/store.ts`, focused runtime-budget tests, full root tests, and `npm run typecheck` / `npm run build`.

## Security review

Result: `CRITICAL=0`, `MAJOR=0`.

- Budget mutation is kernel-authorized; model/provider result data is not an authority to widen or disable a contract.
- Runtime budgets are bounded by explicit maxima; cancellation uses the existing SIGTERM → bounded grace → SIGKILL path.
- Late results remain subject to existing state and lease-generation fencing and cannot complete a terminal attempt.
- Provenance validation rejects secret-like values; raw prompts, provider payloads, and command output are not added to runtime contracts or V12 telemetry.
- The changed-file lint check produced no errors. The repository-wide lint command still reports its pre-existing baseline diagnostics in unrelated files; the differential lint policy passes.

Evidence: shared contract adversarial tests, sandbox cleanup/fencing canaries, control-plane persistence tests, `node --test scripts/ci/differential-biome-lint.test.mjs`, and `git diff --check`.

## Runtime / research review

Result: `CRITICAL=0`, `MAJOR=0`.

- Provider transport/queue/inference, tool, verification, attempt, experiment-cell, run, kernel-cancellation, retry, and late-result outcomes have distinct deterministic reason codes and authorities.
- Provider health and workload runtime-envelope viability are separate concepts. An attempt deadline is propagated as an attempt-owned reason and is not inferred as `PROVIDER_FAILURE`.
- OpenCode's provider request controls remain subordinate to the Positron kernel deadline; the local CLI was verified as `1.18.23`.
- Calibration and holdout fingerprints are required to be disjoint and frozen before holdout use; budget mutation is `EXPERIMENT_CONTRACT_CHANGED`.
- Retry tests prove that a retry cannot reset the parent budget or create unbounded runtime.

Evidence: `docs/evidence/issue-478/runtime-budget-contract.md`, shared/sandbox/control-plane canaries, `npm test` (`2724/2724` root and `421/421` web), and the OpenCode documentation links in the contract evidence.
