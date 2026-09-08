# Bootstrap hard-gate specification

## Scope

Introduce a local-first, repository-native gate entrypoint.  It separates safe
local work from GitHub control-plane readiness and records reproducible gate
evidence without exposing secrets or requiring remote access.

## Acceptance criteria

- G10 through G100 are addressable through `.gates/run-gate.sh`.
- G30 admits mutation only for a non-default branch with a clean or explicitly
  acknowledged working tree.
- G35 reports unavailable GitHub/browser capability as deferred, not as a
  local-preflight failure.
- G40, G50, G60, G70 and G80 bind validation and commit readiness to the
  current tree fingerprint.
- The gate implementation has happy-path and negative-control self-tests.
