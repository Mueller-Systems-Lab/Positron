# Issue #308 — Current Phase 3/4 Validation Plan

## Phase A — Reality and design

1. Reconcile current `main`, Issue #308/comments, open PRs/issues, historical
   Phase 1/2 evidence, Stage-3 modules, durable control-plane path, OpenCode
   adapter, and stale target status.
2. Identify exact current Run/Job/Attempt, queue/admission, workspace/lease,
   provider reservation, approval, and idempotency identifiers.
3. Decide the least-invasive run-bound approval composition and document the
   canonical path and stop conditions.

## Phase B — Narrow remediation

1. Refresh the Stage-3 canonical manifest for the dedicated sandbox and remove
   stale target/credential wording.
2. Add the dated current approval package and correlation contract.
3. Add run-bound approval validation and per-mutation revalidation.
4. Connect the bounded Stage-3 executor at the canonical pipeline boundary,
   preserving controller authority and generic-path safety.
5. Add deterministic Phase 3/4 tests, including writer spies and zero-call
   denial assertions.

## Phase C — Review and integration

1. Run focused tests, typecheck, build, formatting, and security/artifact scans.
2. Execute the required read-only reviewer inventory against the exact
   remediation head; fix no more than three rounds of actionable failures.
3. Merge the remediation PR by exact head and refresh `main`.

## Phase D — Provision and freeze

1. Provision only `Mueller-Systems-Lab/positron-308-sandbox` if still absent,
   with one stable README base commit and no workflows/secrets.
2. Verify repository identity, numeric ID, main SHA, absent target objects,
   scoped credential, locks/leases/reservation, and all machine evidence.
3. Freeze actual IDs, exact bytes/hashes, manifest hash, expiry, and approval
   fingerprint; stop for the single run-specific owner approval.

## Phase E — Authorized execution

1. Validate the exact approval envelope and execute one canonical supervised
   run with exactly one branch/file/commit/draft PR in the sandbox.
2. Verify read-after-write and idempotency without a second real effect.
3. Release lease, lock, reservation, workspace, and ephemeral credential.

## Phase F — Failure modes and closeout

1. Execute deterministic denial, timeout, workspace-lock, missing-env, and
   safe interception-canary tests with zero external mutations.
2. Complete all 17 independent read-only reviewer sessions and regression.
3. Create, review, freeze, and exact-head merge the Positron closure PR.
4. Post one consolidated evidence comment and close Issue #308; verify #447 is
   still open and untouched.
