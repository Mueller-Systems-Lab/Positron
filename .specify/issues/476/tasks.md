# Issue #476 — Exploration Efficiency Tasks

- [ ] Document local reality, post-merge main qualification, P5 inventory, and
      runtime/tool availability.
- [ ] Define the immutable `PROGRESSIVE_LOCALIZATION_V1` candidate and compute
      its fingerprint before holdout runs.
- [ ] Create disjoint design/holdout fixtures and persist their fingerprints.
- [ ] Add metadata-only telemetry extraction for reads, searches, context,
      patch timing, verification timing, repeats, failures, and provenance.
- [ ] Add deterministic quality/non-inferiority/efficiency gate evaluation.
- [ ] Add negative broad/repetitive exploration canary and security assertions.
- [ ] Execute A/B/C with at least five independent holdout tasks per arm, or
      record an explicit amber insufficient-evidence decision.
- [ ] Run architecture, security, and research reviews with zero unaddressed
      CRITICAL/MAJOR findings.
- [ ] Run focused, control-plane, full, typecheck, build, lint, format, and
      relevant visible E2E gates.
- [ ] Publish redacted evidence, acceptance mapping, diff summary, and branch/
      PR state; leave productization disabled unless proven.
