# Issue #476 — Repository Exploration & Context Efficiency Specification

## Scope

Run one bounded, offline-or-disposable-runtime experiment for a versioned
Exploration/Context Strategy Candidate. Reuse the existing P5 task/effective
harness and evaluation concepts. The candidate is advisory context-selection
behavior only; it cannot change the model, permissions, verification contract,
holdout selection, retry policy, security policy, or promotion authority.

No new control plane, database, queue, scheduler, memory store, runtime, or
product UI is in scope. Research scripts and redacted evidence may be added
only when they are reusable and remain non-authoritative.

## Predeclared experiment

- A: current validated harness/profile and current repository exploration.
- B: the same provider, model, permissions, task, verification, max steps,
  timeout, context ceiling, and retry policy with one frozen strategy:
  `PROGRESSIVE_LOCALIZATION_V1`.
- C: the same no-candidate baseline with the candidate arm's declared compute
  ceiling matched; C is not intentionally weakened.
- Design/source tasks and HOLDOUT tasks are distinct and are fingerprinted
  before any holdout run. `DESIGN_HOLDOUT_INTERSECTION=0` is mandatory.
- Minimum sample is five independent holdout tasks per arm. A result below this
  threshold is `AMBER_POSITRON_EXPLORATION_EVIDENCE_INSUFFICIENT`.
- Candidate mutation after holdout start is invalid and must be rejected.

## Closure extension (predeclared)

The closure run adds exactly two independent paired holdout tasks, each run on
A/B/C: `holdout-6-has-own-key` and `holdout-7-retry-status`. The extension is
six submitted cells total, all attempted, with no optional stopping or further
task addition after results are observed. The original five holdouts and their
invalid provider cells remain unchanged in the combined analysis.

The strategy is deliberately small and bounded: inspect the task/test signal,
rank likely symbols/files, admit only the highest-confidence context, suppress
identical reads, and widen only when the observed evidence requires it. It may
not read secrets or leave the declared disposable workspace.

## Metrics and value gate

The primary quality gate is declared before execution:

`VERIFIED_SUCCESS_NON_INFERIOR=YES` when B's verified-success rate is no more
than 10 percentage points below the lower of A and C. This is a small-sample
operational margin, not a claim of statistical significance.

The primary efficiency metric is the median `TOOL_CALLS_TO_VERIFIED_SUCCESS`
across valid successful runs. A positive result requires B to beat both A and C
by at least one call and at least 10% relative on that metric. Secondary
metrics are median admitted context/reported tokens, time to verified success,
unique files/regions, search/read calls, calls before first patch, and repeated
read rate. Recall, precision, irrelevant-context ratio, and churn remain
`UNKNOWN` unless valid ground truth is available.

All metrics must be metadata-only, provider-reported where claimed, and
reported with valid-run counts and failure classifications. Costs are
`NOT_AVAILABLE` unless genuinely reported.

The only positive classification is:

`GREEN_POSITRON_EXPLORATION_EFFICIENCY_VALUE_PROVEN`

and requires non-inferior quality, primary efficiency improvement against A and
C, no compute explanation, no security/permission/critical regression, no
holdout leakage, and reproducible fingerprints. Otherwise use the exact
predeclared negative or amber classification and keep productization disabled.

## Security and negative canary

The candidate must not read `.env`, SSH material, credentials, secrets, files
outside the workspace, or mutate policy, permissions, GitHub, branches,
holdouts, evaluators, or production pointers. A broad/repetitive strategy is
run as a negative canary and must be rejected as inefficient or regressive with
an unchanged disposable workspace.

## Acceptance criteria

- [ ] Existing P5 architecture and ownership are reused.
- [ ] Candidate, metrics, partitions, thresholds, and exclusions are frozen
      before holdout execution.
- [ ] A/B/C has at least five valid independent holdout tasks per arm, or the
      outcome is explicitly AMBER.
- [ ] Metadata-only exploration telemetry is captured without raw source,
      prompts, provider output, or secrets.
- [ ] Negative exploration canary is rejected.
- [ ] Architecture, security, and research reviews report CRITICAL/MAJOR.
- [ ] No productization is implemented unless the positive value gate passes.
- [ ] Evidence, tests, build status, diff, risks, and this mapping are written
      to GitHub and `docs/evidence/issue-476/`.
