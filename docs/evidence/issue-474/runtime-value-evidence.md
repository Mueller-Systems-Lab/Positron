# Issue #474 — Runtime Value Evidence

Date: 2026-08-31  
Classification: `GREEN_POSITRON_SKILL_SPECIALIZATION_REJECTED_NO_MARGINAL_UTILITY`

This report closes the Phase-0 evidence gap with bounded, real OpenCode
runtime trajectories. It does not claim that procedural skills can never be
useful in other task families. It rejects productization of this candidate
because it produced no marginal objective utility on the predeclared
independent holdout family.

## Runtime provenance

| Field | Value |
|---|---|
| Provider | `opencode` |
| Model | `mimo-v2.5-free` |
| OpenCode | `1.18.23` |
| Agent/profile | `build`, project-local permissions, `--auto` |
| DeepSeek agent usage | `0` |
| Paid provider enablement | `NO` |
| Task family | small deterministic JavaScript boundary-normalization repairs |
| Fixture mutation | disposable bounded copies only; no production repository mutation |
| Verification | external `npm test` / Node test runner, exactly one test per fixture |

The first attempted A/B/C series was excluded as `HARNESS_FAILURE`: the
runner placed its own JSON/log files inside the agent workspace, so the agent
could observe generated telemetry. The series was retained locally until
review and was not used in the result. A corrected second series wrote all
logs outside agent workspaces and is the only series below.

## Source trajectories and frozen candidate

Two real source trajectories each contain:

1. an externally failing, analysis-only first attempt;
2. a meaningful strategy delta: inspect tests and implementation together,
   normalize at the function boundary, preserve the public API, and verify;
3. a successful second attempt (`1/1` test passed).

Source attempt references:

- `runtime:source-1:attempt-1->attempt-2`
- `runtime:source-2:attempt-1->attempt-2`

Source runtime evidence fingerprints:

- `e3b73d9c7ca5346632651ebdc4c5da53303e5efd9a286b8a63e312135ec51e26`
- `42b14903e5b34a75fe47b76cbafeaf9e40e9604c7c752f15b64491f1739e50de`

Candidate was frozen before the first holdout run:

| Field | Value |
|---|---|
| candidate_id | `skill-474-boundary-normalization-001` |
| candidate_version | `1.0.0` |
| candidate_fingerprint | `414381c4eaf771d7e02ae1cd37a4767a9110b3628232840ac7d2cd1d3f991b88` |
| target_task_class | `javascript-boundary-normalization` |
| routing | deterministic tests expose conversion/normalization boundary failures |
| triggers | blank, invalid, whitespace, or separator boundary; public API can remain stable |
| procedure | inspect test+implementation; identify invariant; normalize at boundary; preserve API; run focused/full tests |
| resources | `repo:node-test`, `evidence:runtime-source-attempts` |
| compatibility | OpenCode `1.18.23`, Node test/javascript, freshness max 30 days |
| recovery/stop | stop on ambiguous contract, unrelated API change, or failed bounded verification |
| provenance | `runtime-manual-extractor:issue-474:v1`, source fingerprints above |
| status | untrusted, eligible for evaluation only; never promoted |

`CANDIDATE_MUTATION_AFTER_HOLDOUT_START=DENIED`: the frozen candidate JSON
SHA-256 stayed `c26045598edc2f8b332dbdcc457f34a29a6caa53b94f8856d7870684aab3adeb`.
A simulated post-freeze procedure mutation retained the old fingerprint and
was rejected by `SKILL_SCHEMA_INVALID`.

## Partition and holdout controls

| Field | Value |
|---|---|
| source fixtures | `source-1`, `source-2` |
| holdout fixtures | `holdout-1` … `holdout-5` |
| source partition fingerprint | `8b269e0b663980b7e496b3f9f3ad658dd3a1c046811acc8635de607e53bdf1b0` |
| holdout partition fingerprint | `58e9cf3f948464bba09c4b187ec007c517948c389085cc441268fbb8c73d5c42` |
| partition intersection | `0` |
| candidate mutation after holdout start | denied |
| hidden holdout supplied to candidate generator | `NO` |

Holdout tasks were independent from the two source tasks and did not reuse
their function names or expected repairs.

## A/B/C results

Each arm ran once per independent holdout task. The A/B/C copies had the same
provider, model, agent, permissions, task input, and starting fixture. C used
the no-skill matched-control prompt. The evaluation runner supplied a fixed
10% relative runtime budget tolerance before invoking the value gate. The
implemented evaluator reports B/C compute matching as `true`; the CLI did not
expose an exact per-run step or timeout budget, so no stronger compute claim is
made.

| Metric | A — no skill | B — candidate | C — matched no skill |
|---|---:|---:|---:|
| sample size | 5 | 5 | 5 |
| valid runtime attempts | 5 | 5 | 5 |
| verified success | 5 | 5 | 5 |
| verified success rate | 100% | 100% | 100% |
| first-pass success | 5 | 5 | 5 |
| attempts / verified success | 1.0 | 1.0 | 1.0 |
| median time to verified success | 38,383 ms | 38,045 ms | 35,070 ms |
| total tool calls | 46 | 41 | 38 |
| median tool calls | 9 | 8 | 8 |
| search calls (`glob`/`grep`) | 0 | 1 | 1 |
| read calls | 30 | 26 | 24 |
| median files read | 3 | 3 | 3 |
| median tool calls before first patch | 7 | 6 | 6 |
| median time to first patch | 21,470 ms | 21,806 ms | 18,611 ms |
| repeated reads | 0 | 0 | 0 |
| median reported context tokens | 22,850 | 22,511 | 22,641 |
| token provenance | verified | verified | verified |
| cost per verified success | `NOT_AVAILABLE` | `NOT_AVAILABLE` | `NOT_AVAILABLE` |
| retry / escalation count | 0 / 0 | 0 / 0 | 0 / 0 |
| security / regression result | PASS / 0 | PASS / 0 | PASS / 0 |

The evaluator result is:

```text
classification=AMBER_SKILL_NO_MARGINAL_UTILITY
reason_code=SKILL_NO_MARGINAL_UTILITY
verified_success_rate={a:1,b:1,c:1}
holdout_leakage=false
compute_matched=true
token_context_overhead=-1.4836%
cost_per_verified_success=NOT_AVAILABLE
```

B is not better than A or C on the predeclared objective. The small runtime
differences do not establish an efficiency advantage and do not overcome the
equal success rates.

## Exploration evidence

Metadata-only telemetry was captured from the corrected series: read/search
counts, distinct file counts, tool calls before first patch, first-patch
latency, repeated reads, context-token totals, and ranked-region fields where
available. No raw prompts, source snapshots, secrets, or provider outputs are
part of the committed evidence. Region recall, irrelevant-context ratio and
exploration churn remain `UNKNOWN` where the runtime did not report a reliable
value.

## Negative runtime canary

An intentionally rejected candidate declared obsolete tool version `0.1.0`
and contradictory permission guidance. The bounded OpenCode canary returned
`NEGATIVE_CANDIDATE_REJECTED`; the fixture workspace remained byte-identical.
The static Phase-0 quality gate also rejects the mutated candidate. Therefore:

```text
NEGATIVE_RUNTIME_SKILL_PROMOTED=NO
NEGATIVE_RUNTIME_SKILL_CANARY=PASS
```

## Decision

```text
SKILL_SPECIALIZATION_VALUE_PROVEN=NO
SKILL_MARGINAL_UTILITY=SKILL_NO_MARGINAL_UTILITY
PRODUCTIZATION_IMPLEMENTED=NO
VALUE_GATE=DO_NOT_BUILD_PRODUCT_SPECIALIZATION
```

No new candidate store, database, scheduler, promotion engine, memory store,
or product UI was built. Existing P5.4 remains untouched and authoritative.

## Reproducibility artifacts

Raw runtime JSON was intentionally kept out of Git because it contains
provider/tool event payloads and is not needed for the redacted report. The
ephemeral local artifact root was:

```text
.tmp/issue-474-runtime/
```

Aggregate artifact fingerprints:

```text
candidate.json       c26045598edc2f8b332dbdcc457f34a29a6caa53b94f8856d7870684aab3adeb
partition.json       4e47f28436b21d25a6457a8467b62279e7df9d4e4e723d344d31fd547bd65244
metrics.json         b228ac476869e61639ec5a6c5f6dfbe9f1cbac1d997b4beee46f955eaf8e4eac
runtime-value-gate   f4f43d300f85d981e671e7a6b93231ed188aaf082e102c24ba41637fd7907e9f
negative canary      c4e25ff9c041be55b5eb78be22e8bea8a8c65a42a0282f5092323374afc48604
```

The raw artifacts are disposable and are not a substitute for this reviewed,
redacted evidence.

## Persistent OpenCode autonomy canaries

The project-local `.opencode/opencode.json` now contains explicit deny rules
for secret material and credential files, SSH private keys, `.env` files,
destructive filesystem operations, unsafe Git force/reset/clean operations,
protected-branch checkout/merge/push, release/deploy commands, and policy
file edits. `opencode debug config` exited `0` and resolved the deny patterns
for the `build` agent.

```text
PERSISTENT_AUTONOMY_CONFIGURED=YES
AUTHORIZED_DEV_ACTION_AUTO=PASS
FORBIDDEN_SECRET_ACTION_DENIED=PASS
DESTRUCTIVE_ACTION_DENIED=PASS
```

The positive canary edited only a bounded sentinel file. The secret and
destructive canaries were refused by the runtime safety policy; the
destructive target remained present. No credential or secret content was
read or persisted.

## Final reviews

Three read-only reviews were run after the runtime evidence was frozen:

| Review | Result | Critical findings | Major findings |
|---|---|---:|---:|
| Architecture | `PASS` — within bounds; single controller maintained; no productization after the negative gate | 0 | 0 |
| Security | `PASS` — no permission expansion, self-promotion, secret exposure, or push/merge/deploy authority | 0 | 0 |
| Research / runtime-method | `PASS` — OpenCode `--auto`, `--agent`, and JSON event claims agree with official documentation | 0 | 0 |

The architecture review's only note was to verify the autonomy deny rules in
the final PR diff; `.opencode/opencode.json` is included in this change and
was validated with `opencode debug config`. No review required a code fix.

## Final visible Playwright closure

After functional validation, reviews, documentation, and commits, the final
browser run used the repository's existing route-smoke and diagnostic suites:

```text
DISPLAY=:0
WAYLAND_DISPLAY=
PLAYWRIGHT_MODE=HEADED_VISIBLE
command= npx playwright test e2e/route-smoke.spec.ts e2e/diagnostic-reality-check.spec.ts --headed --workers=1 --trace on --reporter=line
tests=15/15 PASS
HEADED_BROWSER_VISIBLE=YES
```

All nine application routes were tested, including Dashboard, Runs, Run
Detail, Evidence, Harness Evolution, repositories, projects, settings, and
admin. The diagnostic suite captured eight redacted screenshots, 794 network
entries, and 32 console entries. Page errors and console errors were both
zero. Five logged network failures were expected SSE teardown races after
the page/context closed; HTTP failures during the checks were zero.

Route manifest SHA256:

```text
fd369d4a2b55e136ac286ec3fece9fb38b2fd91c09d1f7fad390ab744e3130a5  test-results/positron-reality-check/manifest.json
522ca7cc333c8d3e739495e784614020b3480c1c363ff38856b74a4c74ed54e6  test-results/route-smoke/manifest.json
```

Screenshots and traces remain in the gitignored local `test-results/`
directory; the final run produced 17 screenshots and 15 traces. The
diagnostic network and console logs are also local-only. These artifacts are
not committed because they contain runtime event metadata and are available
by the manifest paths and hashes above.
