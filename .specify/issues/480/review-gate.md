# Issue #480 — Review Gate

Three independent review records are required before the final decision:

- Architecture: candidate remains advisory; existing runtime/evaluation
  authority is reused; no production activation or duplicate evaluation plane.
- Security: no workspace escape, secret access, permission/budget escalation,
  deadline bypass, or telemetry leakage.
- Research: no #476/calibration/holdout leakage, optional stopping, candidate,
  metric, threshold, compute, runtime-contract mutation, or cherry picking.

Landing requires `CRITICAL=0` and `MAJOR=0` for every review, evidence with
tests/build/diff/acceptance mapping, and productization disabled.
