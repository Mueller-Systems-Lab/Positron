 # Issue #474 Phase-0 Plan

1. Add typed Phase-0 experiment inputs/results and deterministic quality/value
   gates in `packages/control-plane`, reusing existing fingerprint and
   contract validation primitives.
2. Add adversarial tests for skill injection, path/secret portability,
   version mismatch, train/holdout separation, A/B/C matching, sample-size,
   negative utility, and metadata-only exploration telemetry.
3. Add a redacted, reproducible evidence fixture/report that explicitly
   distinguishes repository facts from experimental results and does not claim
   real model success without verified runtime evidence.
4. Run focused control-plane tests, then repository baseline gates; classify
   pre-existing failures separately.
5. Perform architecture, security, and research reviews; update Issue #474 and
   leave productization disabled unless the value gate is genuinely proven.
