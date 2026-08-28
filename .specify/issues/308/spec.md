# Issue #308 — Current Phase 3/4 Validation Specification

## Status

Current specification generated 2026-08-28 from the live Issue #308 contract,
the current `main` commit `fe118ee53e6ff6eb0e4b36ae53f8dca21fe15c37`, and the
current Stage-3/durable-control-plane implementation.

## Goal

Validate supervised Real Mode through Positron's canonical intake → admission →
scheduler → durable Run/Job/Attempt → workspace/lease/provider controls →
worker/review/verify → pre-write → run-bound approval → bounded Stage-3 GitHub
adapter path, producing exactly one branch, one file, one commit, and one draft
PR in the dedicated non-production repository
`Mueller-Systems-Lab/positron-308-sandbox`. The sandbox PR must remain unmerged.

Validate denial, timeout, workspace-lock, missing-environment, and safe
in-run-denial-canary behavior with zero external mutations.

## Non-goals and invariants

- Issue #308 remains research/validation; narrowly required implementation is
  tracked separately in one child issue.
- `Mueller-Systems-Lab/Positron` is denylisted for Stage-3 writes, with the
  historical `xxammaxx/Positron` alias retained when safe.
- No production write, merge, release, deployment, tag, package publish,
  force-push, history rewrite, or #447 work.
- DeepSeek usage is zero.
- A single approval envelope binds all actual execution correlation IDs and
  every exact effect parameter; it is revalidated before branch, commit, and
  draft-PR mutation boundaries.
- Missing, expired, mismatched, or duplicate approval/effect state fails closed
  before the writer call.
- One source of truth supplies marker bytes, lengths, hashes, metadata, limits,
  and manifest hash.

## Acceptance criteria

1. Existing Phase 1 and Phase 2 evidence remains historical and focused
   regressions pass.
2. Current Stage-3 target and approval package are reconciled without
   rewriting historical evidence.
3. All actual durable execution correlation IDs are identified and bound.
4. The canonical pipeline reaches the bounded Stage-3 mutation path.
5. One real sandbox branch, file, commit, and draft PR are created; no merge or
   other external effect occurs.
6. Phase 4 denial, timeout, workspace-lock, missing-env, and interception canary
   tests fail closed with zero writer calls and zero external mutations.
7. Complete current evidence, secret/artifact scans, deterministic tests, and
   17 independent read-only reviewer records are produced.
8. A final Positron closure PR is merged by exact frozen head; Issue #308 is
   closed only after the acceptance matrix is green. Issue #447 remains open and
   untouched.

## Evidence policy

Historical artifacts are not rewritten. New current artifacts are dated and
generated from the current manifest, current durable IDs, and current test
results. Credential values never enter source, logs, evidence, comments, or
screenshots.
