# Issue #480 — Exploration Efficiency Replication Specification

## Research question

Can `PROGRESSIVE_LOCALIZATION_V1` preserve verified success rate while reducing
the median number of tool calls to verified success versus both the current
baseline and a compute-matched no-candidate baseline under
`positron.runtime-budget.v1`?

This is a bounded replication for the tested task family and provider/model/
harness family only. Issue #476 is historical context; none of its samples,
design/holdout tasks, or historical candidate examples are eligible here.

## Frozen candidate and arms

- Candidate: `PROGRESSIVE_LOCALIZATION_V1`, version `1.0.0`, reconstructed from
  the historical source unchanged in strategy; only runtime-contract metadata
  may be added.
- A: current validated harness/context behavior.
- B: A plus the candidate as advisory context selection.
- C: no candidate, with the same declared resource envelope as B.
- Same task, workspace baseline, provider, model, permissions, reasoning mode,
  verification, retry policy, max steps, and frozen runtime budget for all arms.
- No production activation, routing authority, or productization.

## Partitions and sample size

- Calibration: exactly 3 new neutral representative tasks; excluded from all
  value statistics and disjoint from #476, candidate source examples, and the
  hidden holdout.
- Hidden holdout: exactly 6 new tasks, each run once on A/B/C = 18 cells.
- All 18 cells are attempted. No optional stopping and no additional samples.
- Partition IDs and fingerprints are frozen before hidden holdout execution.

## Metrics and gates

- Primary quality: `VERIFIED_SUCCESS_RATE`.
- Quality non-inferiority: B is no more than 0.10 below `min(A,C)`.
- Primary efficiency: median `TOOL_CALLS_TO_VERIFIED_SUCCESS` among valid
  successful outcomes. B must improve against A and C by at least 1 absolute
  call and at least 10% relative.
- Secondary metrics are context/tokens, elapsed time, searches, reads, unique
  files/regions, calls before first patch, and repeated reads.
- Minimum valid sample for value decision: A/B/C each >= 5. Otherwise the
  final classification is `AMBER_POSITRON_EXPLORATION_REPLICATION_INSUFFICIENT_VALID_RUNTIME`.

## Runtime and validity

Calibration derives a conservative fixed envelope. Before holdout, freeze
`positron.runtime-budget.v1`, its fingerprint, and the calibration/holdout
separation contract. After holdout start mutation is denied.

Exactly five neutral health canaries must pass the declared gate (>=4 valid,
no auth failure, systematic provider timeout, or harness failure). A separate
non-holdout workload-envelope gate is required. Valid task outcomes are a
successful bounded attempt with verifier pass and no error event. Provider,
tool, verification, attempt, cell, run, kernel, and fencing terminations are
invalid infrastructure samples and retain their precise reason codes.

## Decision and stopping

After all 18 cells, evaluate the frozen gate exactly once. Positive value also
requires no compute/runtime-variance explanation, leakage, security or
permission regression, candidate drift, metric/threshold drift, and a rejected
negative control (`BROAD_REPETITIVE_CONTEXT`). If not positive, close this
research line without a V2 candidate or another exploration run.

## Acceptance criteria

- [ ] Current main freshly qualified and new independent issue/spec/plan/tasks recorded.
- [ ] Candidate, partitions, runtime contract, metrics, thresholds, and stopping rule frozen.
- [ ] Calibration, health, workload-envelope, holdout, negative-control, and review evidence recorded.
- [ ] Exactly 18 holdout cells attempted with metadata-only telemetry and no #476 reuse.
- [ ] Final gate evaluated exactly once; no productization or production activation.
- [ ] Regression/static/security/path/policy checks and final visible headed browser gate recorded.
