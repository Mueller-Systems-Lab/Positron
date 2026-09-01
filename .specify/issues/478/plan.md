# Plan — Issue 478 Runtime Budget Contract

## Design gate

Implement only after `spec.md` and `tasks.md` are present. Extend existing cancellation, command execution, attempt persistence, and fencing mechanisms.

## Work packages

1. **Shared contract and policy**
   - Add the versioned runtime budget/termination types, reason-code taxonomy, bounded validation, canonical fingerprinting, child derivation, freeze semantics, and calibration/holdout validation.
   - Add pure contract tests for deterministic fingerprints, malformed values, parent-child bounds, frozen mutation, and partition intersection.

2. **Execution boundary integration**
   - Extend `runCommand` with an optional runtime budget slice, monotonic deadline enforcement, typed termination errors, bounded grace, and kernel-vs-provider attribution while preserving legacy callers.
   - Extend OpenCode input/result contracts and `RealOpenCodeAdapter` to accept a kernel-owned slice, preserve OpenCode provider timeout as a subordinate control, and return explicit reason/authority.

3. **Durable control-plane evidence**
   - Add idempotent V12 nullable columns to `cp_attempts`, update migration shape/version and store mapping/insert/complete paths.
   - Add tests for legacy rows, migration idempotency, contract persistence, termination telemetry, duplicate completion, late fencing, and recovery.

4. **Canaries and documentation**
   - Add neutral A–F and adversarial runtime canaries using fixtures only: fast success, slow workload, provider failure, tool timeout, verification timeout, parent exhaustion, escalation/bypass, bounded retry, late fencing, and process cleanup.
   - Document the runtime hierarchy, timeout ownership, OpenCode effective chain, reason table, and calibration/holdout rule in canonical architecture/evidence docs.

5. **Review and gates**
   - Run focused tests first, then control-plane/worker/integration/contracts/root/web/typecheck/build/format/lint/security/path/policy gates.
   - Perform independent architecture, security, and runtime/research reviews with critical/major counts.
   - Commit, push, create/update the PR, observe remote gates, then run visible headed Playwright last and revalidate exact head before landing.

## Risks and mitigations

- **Legacy migration risk:** all new columns nullable and added via `columnExists`; historical values remain null/unknown.
- **Timeout race:** monotonic deadline preflight plus single termination settlement and existing attempt state/fencing guards.
- **Budget escalation:** only kernel-created frozen contracts can derive children; model output is data, not authority.
- **Provider misattribution:** explicit kernel termination wins over stderr pattern matching; provider failure requires provider evidence.
- **Subprocess leakage:** reuse owned process-group SIGTERM/SIGKILL path and assert bounded cleanup in canaries.
