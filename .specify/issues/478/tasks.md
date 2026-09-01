# Tasks — Issue 478 Runtime Budget Contract

## Contract

- [x] T001 Add shared `positron.runtime-budget.v1` types, reason codes, bounds, validation, deterministic fingerprint, and immutable freeze.
- [x] T002 Add bounded child-budget/deadline derivation and calibration/holdout freeze validation.
- [x] T003 Add contract tests for valid/invalid inputs, hierarchy, freeze, fingerprints, and partition separation.

## Runtime boundaries

- [x] T004 Extend sandbox command execution with monotonic runtime deadlines, typed termination metadata, bounded grace, and legacy compatibility.
- [x] T005 Extend OpenCode adapter input/result mapping and distinguish kernel/attempt/tool/provider termination.
- [x] T006 Add neutral and adversarial execution canaries, including process cleanup and late-result behavior.

## Durable evidence

- [x] T007 Add additive/idempotent control-plane V12 attempt telemetry columns and migration-shape/version handling.
- [x] T008 Update attempt store create/complete/map paths with contract, budget, cancellation, latency, and fencing telemetry.
- [x] T009 Add migration, persistence, recovery, idempotency, retry-budget, and late-result regression tests.

## Documentation and validation

- [x] T010 Update architecture/evidence docs with hierarchy, ownership, timeout taxonomy, cancellation, fencing, and calibration/holdout contract.
- [x] T011 Run architecture/security/runtime reviews; record CRITICAL/MAJOR findings and resolve task-caused findings (maximum three fix loops).
- [x] T012 Run all focused and full local gates; create/update PR with evidence and exact acceptance mapping.
- [ ] T013 Run visible headed Playwright last, observe remote gates, exact-head-gated land if permitted, and freshly qualify post-merge main.

## Explicit non-goals

- [x] T014 Confirm Issue #476 remains closed, no new exploration experiment starts, and no exploration productization is introduced.
