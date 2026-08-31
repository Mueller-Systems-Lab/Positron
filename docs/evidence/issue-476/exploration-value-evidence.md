# Issue #476 — Repository Exploration & Context Efficiency Evidence

Date: 2026-08-31
Classification: `AMBER_POSITRON_EXPLORATION_EVIDENCE_INSUFFICIENT`

## Hypothesis and predeclared gates

The hypothesis was that a small repository-exploration/context-selection
strategy can preserve verified repair quality while reducing exploration cost.
The primary metric was median `TOOL_CALLS_TO_VERIFIED_SUCCESS`. B had to be
non-inferior to the lower of A/C within 10 percentage points and beat both
controls by at least one call and 10% relative. The minimum was five valid
independent runtime attempts per arm. These rules were frozen in
`.specify/issues/476/spec.md` before the holdout run.

## Candidate and partitions

| Field | Value |
|---|---|
| Candidate | `PROGRESSIVE_LOCALIZATION_V1` |
| Candidate fingerprint | `3fcdff1dcfa1c38ad57740eaaca08dc60926a569779297f3648c0328bb90ab07` |
| Strategy | test/symbol-first localization, top-ranked context admission, repeated-read suppression, progressive widening |
| Provider/model | OpenCode / `opencode/mimo-v2.5-free` |
| OpenCode | `1.18.23` |
| Declared budgets | max steps 12; timeout 180000 ms; context ceiling 30000; retries 0 |
| Permissions / verification | identical across A/B/C; external `npm test` |
| Design partition fingerprint | `51339de2cf47db9d0ab68487df9f63bad2b286a92f716f5876c6786abd5fe3f8` |
| Holdout partition fingerprint | `46f6b6d4961404b2d45b98e499ee485966f3e6bac31285d4eabe76a69985bda7` |
| Design/Holdout intersection | `0` |
| Candidate mutation after freeze | `NO` |

The five holdouts were new disposable JavaScript boundary-normalization tasks
with distinct names from the two design references. Raw fixtures and provider
event payloads remain outside Git under a temporary `/tmp` root.

## A/B/C runtime results

All arms had five submitted cells. A and C each had one provider-invalid cell:
the external test still passed, but the OpenCode process reached the bounded
timeout and was not counted as a valid runtime attempt. There were no retries.

| Metric | A — current | B — candidate | C — compute-matched current |
|---|---:|---:|---:|
| Submitted sample | 5 | 5 | 5 |
| Valid runtime attempts | 4 | 5 | 4 |
| Verified success (valid denominator) | 4 | 5 | 4 |
| Verified success rate | 100% | 100% | 100% |
| First-pass success | 4 | 5 | 4 |
| Tool calls to verified success, median | 9 | 8 | 8 |
| Context/tokens, median | 20468.5 | 20831 | 20439 |
| Time to verified success, median ms | 50312.5 | 48490 | 51797.5 |
| Files read, median | 3 | 3 | 3 |
| Regions read, median | 6 | 6 | 5 |
| Search calls, median | 0 | 0 | 0.5 |
| Read calls, median | 6 | 6 | 5 |
| Calls before first patch, median | 7 | 6 | 6 |
| Repeated-read rate | 0 | 0 | 0 |
| Token provenance | provider-reported | provider-reported | provider-reported |
| Cost per verified success | `NOT_AVAILABLE` | `NOT_AVAILABLE` | `NOT_AVAILABLE` |

Provider-invalid cells were `holdout-4/C` and `holdout-5/A`; both were
classified `PROVIDER_FAILURE` and excluded from valid-run efficiency aggregates.
No verification failure occurred among the completed cells. B's median of 8
tool calls equals C and therefore fails the predeclared requirement to beat both
controls. B also admits more median context than either control.

## Negative exploration canary

The deliberately broad/repetitive candidate
`BROAD_REPETITIVE_V0` supplied synthetic telemetry with 24 reads, six unique
files, 18 repeated reads, and context above the ceiling. The deterministic
canary returned:

```text
NEGATIVE_EXPLORATION_CANDIDATE_REJECTED=PASS
REASON=EXCESSIVE_CONTEXT_OR_REPEATED_READS
WORKSPACE_MUTATED=NO
```

This is a rejection canary, not positive task evidence.

## Security and authority checks

- 15 OpenCode event logs were inspected metadata-only: 93 file-path inputs,
  zero paths outside the disposable runtime root, and zero `.env`, `.ssh`,
  credential, private-key, or certificate paths.
- Candidate and runner change only disposable fixture files; no GitHub, Git,
  production pointer, kernel policy, permissions, holdout, evaluator, or budget
  authority is exposed.
- OpenCode project deny configuration remains parse-valid at version 1.18.23;
  existing policy/secret/traversal/autonomy suites passed 62/62 on post-merge
  main.

## Reviews

Three independent review perspectives were performed against the exact diff;
the attempted broad OpenCode reviewer sessions timed out or returned no
structured conclusion and are not counted as PASS evidence.

| Perspective | Result | Critical | Major | Findings |
|---|---|---:|---:|---|
| Architecture | PASS | 0 | 0 | Disposable scripts only; no duplicate control plane, persistence, scheduler, queue, or promotion authority |
| Security | PASS | 0 | 0 | Workspace/path scan clean; no secret paths; candidate is advisory and fixture-bounded |
| Research/evaluation | PASS with AMBER outcome | 0 | 0 | Frozen metrics, no leakage, identical declared budgets; invalid provider cells retained and excluded honestly |

## Decision

```text
VERIFIED_SUCCESS_NON_INFERIOR=NOT_PROMOTABLE_WITHOUT_MIN_VALID_SAMPLE
PRIMARY_EFFICIENCY_METRIC=NO_IMPROVEMENT_AGAINST_C
COMPUTE_EXPLAINS_GAIN=NO
NO_HOLDOUT_LEAKAGE=YES
NO_SECURITY_REGRESSION=YES
NEGATIVE_EXPLORATION_CANDIDATE_REJECTED=PASS
EXPLORATION_VALUE_PROVEN=NO
PRODUCTIZATION_IMPLEMENTED=NO
FINAL_CLASSIFICATION=AMBER_POSITRON_EXPLORATION_EVIDENCE_INSUFFICIENT
```

The result is intentionally AMBER rather than a positive or negative green
claim: the runtime capacity produced only four valid A and C observations, and
the observed B efficiency is not better than compute-matched C. No additional
provider retries were hidden after the predeclared one-attempt-per-cell run.
No productization is authorized.

## Validation and acceptance mapping

- Harness focused tests: 6/6 PASS; JavaScript syntax checks PASS.
- Post-merge main qualification: typecheck PASS; build PASS; full tests
  2708/2708 plus web 421/421 PASS; contracts 168/168; integration 20/20;
  transfer/review regression PASS. The repository-wide lint and format checks
  report the pre-existing Biome 2.5 configuration/backlog diagnostics; the
  five changed research scripts pass an isolated Biome 2.5 format/lint check,
  and the differential-lint test suite passes. No source lint regression was
  introduced by this issue.
- Final visible Playwright smoke after experiment, decision, reviews, and
  documentation: `PLAYWRIGHT_MODE=HEADED_VISIBLE`, Chromium headed, 15/15
  PASS; route manifest reports zero console errors, zero page errors, and zero
  HTTP failures. The expected fake-mode worker log for a nonexistent demo
  issue is not a browser error.
- Acceptance: architecture reuse, frozen candidate/partitions, telemetry,
  negative canary, review evidence, and no productization are satisfied;
  minimum valid A/B/C evidence is explicitly not satisfied, hence AMBER.

Runtime root for reproducibility: `/tmp/positron-issue-476-runtime-LlUaCh/`.
It contains provider event payloads and is intentionally not committed.
