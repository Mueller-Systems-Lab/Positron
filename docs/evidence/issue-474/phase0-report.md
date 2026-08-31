# Issue #474 — Phase-0 Evidence Report

## Repository fact

- Start head: `e99f20a4f41842e6a9c99ff78f9014b1ff882db4` (`origin/main`)
- Task branch: `positron/issue-474-evidence-gated-skill-evolution`
- The original dirty Issue-464 workspace was preserved. No secrets or raw
  source content are included here.
- P5.1–P5.4 already exist in the starting repository, including the shared
  SQLite evolution tables and deterministic promotion primitives. This change
  adds only an offline Phase-0 projection and tests.

## Phase-0 implementation

`packages/control-plane/src/skill-experiment.ts` provides:

- fingerprinted, trace-derived untrusted candidate metadata;
- fail-closed quality checks for schema, routing, portability/resources,
  compatibility/staleness, secret/prompt injection, and context budget;
- explicit A/B/C arm metrics and compute matching;
- cryptographically-shaped training/holdout references and leakage rejection;
- metadata-only exploration telemetry with `UNKNOWN` support;
- deterministic value classification and verified token/cost provenance.

The module cannot write SQLite, mutate a production pointer, change policy,
select holdout data, or promote a candidate.

## Experiment status

No real model/provider trajectory was executed by this local implementation
run, so no PASS, token count, cost, or generalization claim is made.

| Field | Value |
|---|---|
| A runs | `NOT_EXECUTED` |
| B runs | `NOT_EXECUTED` |
| C runs | `NOT_EXECUTED` |
| Holdout sample | `NOT_EXECUTED` |
| Verified success A/B/C | `UNKNOWN` |
| Token/context overhead | `UNKNOWN` |
| Cost per verified success | `NOT_AVAILABLE` |
| Exploration evidence | contract/test coverage only; runtime evidence `UNKNOWN` |
| Negative skill canary | `PASS` in deterministic test; not runtime evidence |
| Value gate | `AMBER_SKILL_EVIDENCE_INSUFFICIENT` |
| Productization authorized | `NO` |

The positive classification path in the unit test is a logic test fixture, not
experimental evidence. Productization remains disabled until independent,
real or faithfully replayed Positron attempts populate A/B/C and holdout
partitions with immutable evidence.

## Verification

- Phase-0 focused tests: 11 passed.
- TypeScript build: passed.
- Typecheck dry run: passed.
- Focused Biome check with a schema-compatible formatter configuration:
  passed. Repository `biome.json` currently contains legacy keys rejected by
  installed Biome 2.5.10; the repository-wide format gate is therefore a
  pre-existing baseline failure, not attributed to this change.

## Reviews

- Architecture: no second control plane, queue, state machine, database, or
  promotion authority introduced.
- Security: candidate strings are scanned; absolute/traversal paths,
  secret-like material, and authority/policy injection fail closed.
- Research/evaluation: no real-result claim, no cost invention, no sample-size
  one promotion, explicit A/B/C matching, and train/holdout separation.

Classification at this stage is `AMBER_POSITRON_SKILL_EVIDENCE_INSUFFICIENT`.

## Continuation update — 2026-08-31

The runtime evidence gap described above was subsequently closed in the
bounded experiment documented by
[`runtime-value-evidence.md`](./runtime-value-evidence.md). The corrected
OpenCode series ran five independent holdout tasks in each A/B/C arm and
verified `5/5` successes in every arm. The implemented value gate returned
`AMBER_SKILL_NO_MARGINAL_UTILITY` because B did not exceed A or C. No
productization was implemented or authorized. The final research
classification is `GREEN_POSITRON_SKILL_SPECIALIZATION_REJECTED_NO_MARGINAL_UTILITY`.
