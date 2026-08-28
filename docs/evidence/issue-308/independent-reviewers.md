# Issue #308 — independent reviewer lifecycle ledger

Generated: 2026-08-28. This ledger supersedes the earlier statement that all
reviewer spawns failed. It preserves that history while separating spawn,
completion, result capture, and counting.

## Counting rule

A reviewer counts only when the required role was selected, a unique session
was created, the exact review head was supplied, the session ran independently,
a structured result was returned and captured, and its verdict/findings are
available for disposition. Spawned, timed-out, or closed-without-result
sessions do not count.

## Current final-head accounting

| Metric | Value |
|---|---:|
| PLANNED | 17 |
| SPAWN_ATTEMPTED | 19 |
| SPAWNED | 19 |
| COMPLETED | 16 |
| RESULT_CAPTURED | 16 |
| COUNTED | 16 |
| UNIQUE_COUNTED_SESSION_IDS | 16 |
| CHILD_BACKEND_COMPLETED | 0 |
| ISOLATED_BACKEND_COMPLETED | 16 |
| SPAWN_FAILURES | 0 |
| TIMEOUTS | 3 |
| CRITICAL | 0 |
| MAJOR | 0 |
| DEEPSEEK | 0 |

`review-independent-final` is intentionally not started until the other 16
results, their dispositions, this evidence commit, and fresh CI are complete.
Therefore 17/17 is not claimed yet.

## Current final-head role ledger

Review head for every row below: `b0cfd871885cb329d50fc591478de8aaaf28f594`.
Base at the live refresh: `fcea2d1802bd6ba0e19e5fd5edae0987432f4e2e`.
Backend for every counted row: `ISOLATED`.

| Required role | Session ID | Completion | Result | Critical | Major | Verdict | Counted |
|---|---|---|---|---:|---:|---|---|
| audit-repository-reality | `ses_fb8df60bcffe139wqCXR663KWC` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| audit-repository-hygiene | `ses_fb8f1eab8ffeMaeUY004A7rqFM` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-architecture | `ses_fb8f1ea23ffejFuwPqDjqEa22H` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-security | `ses_fb8f1eaf3ffe2CO2TpBXM1FYow` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-devex-installer | `ses_fb8edf6a9ffep2ohidzxKQC4B0` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-docker-infrastructure | `ses_fb8edf666ffe8fhP5yua0NMW3l` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-frontend-landing | `ses_fb8edf665ffekg11aKnNgTypr6` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-ux-accessibility | `ses_fb8edf64effelJPtscC4tV3192` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-visual-qa | `ses_fb8e95c35ffeJx7KuWuiPXUmwq` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-documentation-truth | `ses_fb8e95c44ffeSo4187CMuQVRdL` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-github-pages | `ses_fb8e95c0fffe7SvPmpXp50J7Y2` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-test-tooling | `ses_fb8e95c03ffe03ZXjEj8zD9bQ8` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-integration | `ses_fb8e23a8dffej5hX6VGh6t95iS` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-release-packaging | `ses_fb8e23a8effeTBOB3KmuACL4ot` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-governance | `ses_fb8e6f3a3ffeepmGcLTxl9Lw4f` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| research-official-docs | `ses_fb8e6f3b1ffeX2gcj95C14ouW9` | COMPLETED | CAPTURED | 0 | 0 | YES | YES |
| review-independent-final | — | NOT STARTED | — | — | — | MUST RUN LAST | NO |

Some model responses used generic `ROLE` text or self-reported placeholder
session IDs. The ledger uses the actual session IDs emitted by the isolated
runner, the assigned required role, and the runner-captured structured result.
Those limitations remain in the underlying captured outputs and are not
silently rewritten as stronger evidence.

## Historical recovery and dispositions

The earlier recovered sessions remain valid historical evidence only. They
reviewed earlier heads and therefore do not satisfy the current-head gate.
Known historical findings included productive bootstrap absence, snapshot-only
authority revalidation, approval binding gaps, reservation binding, and missing
Phase-4 coverage. The current branch contains the corresponding narrow
bootstrap, authority-provider, scheduler-binding, and deterministic Phase-4
changes; focused tests and green CI are the evidence for `FIXED` dispositions.

| Historical finding | Severity | Disposition |
|---|---|---|
| Productive Stage-3 bootstrap absent | CRITICAL/MAJOR | FIXED; current bootstrap tests and explicit disabled/default guards |
| Snapshot-only mutation-boundary validation | CRITICAL/MAJOR | FIXED; current authority provider and TOCTOU tests |
| Reservation/run binding gap | MAJOR | FIXED; scheduler binding and authority tests |
| Phase-4 failure-mode coverage absent | MAJOR | FIXED; canonical zero-writer Phase-4 suite |
| Sandbox-only credential unavailable | MAJOR for Phase 3 readiness | PRE_EXISTING_OUT_OF_SCOPE for remediation PR; Phase 3 remains blocked |
| Existing container/UI baseline concerns | MAJOR/minor | PRE_EXISTING_OUT_OF_SCOPE; no related product change |

Additional b0cfd871 final-head reviewer notes were non-blocking: local synchronous
audit-file I/O, limited static-only review, and expected absence of the
sandbox credential. No final-head result identified a Critical or Major issue.

## Failed and superseded lifecycle records

- The first collaborator wave created four sessions but returned no results;
  all were closed as `CHILD_SESSION_STALLED` and count zero.
- Three isolated retries timed out after partial progress and count zero.
- Earlier final-head attempts targeted `6355098` or `ff0e395`; they are not
  current-head reviews after the normal merge of updated `main`.
- Historical recovered sessions at `e917ba6`, `67028d7`, and other prior
  heads remain in the prior ledger history and are not double-counted.
- The old “0/17; every spawn failed” statement is superseded because the
  runtime transcript proves spawned and completed sessions; no success is
  inferred from spawn-only or timeout records.

## Current conclusion

PR #460 is not yet eligible for final independent lifecycle approval solely
from this ledger: current count is 16/17 and the final reviewer must run last.
Phase 3 has not executed, no sandbox credential was acquired, no sandbox PR
exists, and production writes remain zero.
