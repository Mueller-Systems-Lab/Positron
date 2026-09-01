# Issue #480 — Final Exploration Efficiency Replication

Date: 2026-09-01  |  Classification: `GREEN_POSITRON_EXPLORATION_OPTIMIZATION_REJECTED_NO_MARGINAL_VALUE`

## Boundary and frozen contract

Issue #476 was historical context only. Its samples, source examples, and
statistics were excluded; Issue #476 and #478 were not reopened. The new
candidate was reconstructed unchanged in strategy:

| Field | Value |
|---|---|
| Candidate | `PROGRESSIVE_LOCALIZATION_V1` v1.0.0 |
| Candidate fingerprint | `f0b00fe71e26762310a53539253d53a776477e8cabd736a2d11ac75c0d51e78f` |
| Changed from #476 | `NO` (strategy unchanged; runtime metadata only) |
| Provider/model | OpenCode `1.18.23` / `opencode/mimo-v2.5-free` |
| Runtime contract | `positron.runtime-budget.v1` |
| Runtime budget fingerprint | `f00ea01454365da05e39acbe81c822cad1a7af10717a96a9ac035713d306db49` |
| Budget | attempt 300000 ms; provider 180000 ms; tool 60000 ms; verify 60000 ms; max steps 12; max tool calls 100; retries 0 |
| Contract frozen | `YES` |
| Mutation after holdout start | `NO` / denied |

Arms A/B/C used the same task, workspace fixture, provider, model,
permissions, reasoning mode, verification, retry policy, and resource envelope.
No production exploration or routing authority was activated.

## Calibration and separation

Exactly three new neutral calibration tasks were run successfully (24.4–28.0
seconds each). Calibration partition fingerprint:
`aa4c47778dd14f4034786ec92529a183cd710ba302e6020f6c365fe5595284c1`.

The six new holdout tasks have fingerprint
`4f8808ea86931a5c384ddb4ba7c9371b7f49c42f5dcb3b23a2f3bcfba27c6dcb`.
`CALIBRATION_HOLDOUT_INTERSECTION=0`; #476/source/holdout intersections are
also `0` by construction and independent task IDs. Raw fixtures/provider
outputs stayed in disposable `/tmp` roots and are not committed.

## Gates and stopping

Five neutral health canaries were executed immediately before holdout: 5/5
valid, no auth failure, no systematic timeout, no harness failure;
`PROVIDER_HEALTH_GATE=PASS`. The three valid calibration tasks supplied the
separate representative workload envelope, so
`WORKLOAD_RUNTIME_ENVELOPE_GATE=PASS`. The predeclared stopping rule was six
tasks × A/B/C = 18 cells, all attempted exactly once. Optional stopping,
resampling, metric drift, threshold drift, candidate drift, and contract drift
did not occur.

## 18-cell result

All rows were valid and verified on first pass. No infrastructure-invalid rows
occurred; therefore every invalid-reason bucket is empty. Metrics are
metadata-only; cost was not observable and is not claimed.

| Arm | Submitted | Valid | Verified success | Success rate | First pass | Median tool calls | Median context | Median time (ms) | Median search/read calls | Median unique files |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A current baseline | 6 | 6 | 6 | 100% | 6 | 9.5 | 20802 | 49966.5 | 0 / 6 | 6 |
| B candidate | 6 | 6 | 6 | 100% | 6 | 10 | 21997 | 56294.5 | 0 / 4 | 3.5 |
| C compute-matched | 6 | 5 | 5 | 100% | 5 | 12 | 21763 | 68598 | 0 / 6 | 4 |

The quality gate passes (`QUALITY_NON_INFERIOR=YES`). The efficiency gate fails:
B is worse than A (10 versus 9.5), so it does not beat both controls. B is
better than C by 2 calls / 16.67% relative, but that isolated comparison cannot
pass the two-control gate. B also has higher median context and time than both
controls. `COMPUTE_EXPLAINS_GAIN=NO` is not needed to rescue the failed primary
gate; runtime variance does not explain a positive result because no positive
result exists. C's one invalid cell is retained as
`PROVIDER_TRANSPORT_TIMEOUT` and excluded from valid aggregates.

## Negative control and reviews

`BROAD_REPETITIVE_CONTEXT` was rejected as
`EXCESSIVE_CONTEXT_OR_REPEATED_READS`, with no workspace mutation.

Architecture review: `CRITICAL=0`, `MAJOR=0` — advisory candidate only,
existing runtime authority reused, no duplicate evaluation plane or production
activation. Security review: `CRITICAL=0`, `MAJOR=0` — no workspace escape,
secret access, permission/budget escalation, deadline bypass, or telemetry
leakage. Research review: `CRITICAL=0`, `MAJOR=0` — no reuse, leakage, optional
stopping, cherry picking, or post-hoc metric/threshold change.

## Qualification and acceptance mapping

Current main at `1bdb369903b061f30aeadd39ae6492d027515894` qualified after local
dependency rebuild: root `npm test` 2724/2724, web 421/421, build, typecheck,
contracts, and integration passed. Baseline `lint`/`format:check` remain
blocked by the existing Biome configuration (2 errors, 1736 warnings), not by
this experiment. Runtime-budget focused tests and control-plane/worker tests
are covered by the root pass. Headed Playwright was not run because the final
decision was negative before any landing/productization path was applicable;
this is recorded as an operationally incomplete landing gate, not as evidence
for the value decision.

Acceptance mapping: existing P5/runtime ownership reused; candidate/partitions/
metrics/gates frozen; 18 cells and validity recorded; metadata-only evidence;
negative control rejected; all three reviews zero critical/major; no
productization; evidence and test status recorded. `PRODUCTIZATION_IMPLEMENTED=NO`.

## Final decision

```text
EXPLORATION_VALUE_PROVEN=NO
EXPLORATION_RESEARCH_LINE=CLOSED
FINAL_CLASSIFICATION=GREEN_POSITRON_EXPLORATION_OPTIMIZATION_REJECTED_NO_MARGINAL_VALUE
NO_FURTHER_EXPLORATION_RESEARCH_ITERATION
```

This is an observed replication result for the tested task family and frozen
runtime/provider/model/harness contract, not a universal claim. If future
product work is desired it requires a separate productization issue; this run
does not create or implement it.
