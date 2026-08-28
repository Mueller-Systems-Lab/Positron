# Issue #308 — Phase 4 failure-mode matrix

Generated: 2026-08-28.

Phase 3 has not started. The Phase 4 evidence below is therefore a
deterministic, zero-effect validation of the canonical pipeline and bounded
Stage 3 boundary; it is not a claim that the real sandbox was mutated.

| Case | Result | External mutations |
|---|---|---:|
| Denial before pre-write | PASS | 0 |
| Approval/lease timeout | PASS | 0 |
| Competing workspace lock | PASS | 0 |
| Missing environment/credential | PASS | 0 |
| Provider reservation loss | PASS | 0 |
| Run-bound identity mismatch | PASS | 0 |
| Base-SHA drift | PASS | 0 |
| Duplicate idempotency | PASS | 0 |
| In-run denial canary | PASS (intercepted) | 0 |

## Canonical test provenance

`packages/worker-pipeline/src/__tests__/stage3-phase4-fail-closed.test.ts`
enters through `runPipeline` for the denial, timeout, lock, provider,
run-bound, base-SHA, and idempotency cases. Writer calls are spied and remain
zero. Missing credential is rejected by the productive bootstrap before an
executor is constructed. The boundary tests also cover authoritative
revalidation immediately before branch, commit, and PR mutation.

The real sandbox credential, real sandbox writes, and real Phase 3 run remain
pending by design.
