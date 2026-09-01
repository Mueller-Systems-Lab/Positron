# Issue #476 — Exploration Efficiency Plan

1. Reconcile the post-merge main baseline, P5 profile/evaluation APIs, runtime
   availability, and prior #474 telemetry without treating it as attribution.
2. Freeze the candidate definition, design/holdout fixtures, fingerprints,
   A/B/C budgets, quality margin, primary metric, and negative canary.
3. Implement only a disposable research runner/metric adapter and focused
   tests; keep strategy behavior inside existing task/effective-harness fields.
4. Execute the real or faithfully replayed A/B/C holdout series with identical
   provider/model/permissions/verification and external verification.
5. Run the negative canary and security/policy checks; classify failures and
   unknowns without inventing ground truth or costs.
6. Freeze the lexicographic value decision, run architecture/security/research
   reviews, and implement no productization unless every positive gate passes.
7. Run the required repository checks and finish with a visible Playwright
   regression smoke; record all evidence and the PR handoff in GitHub.
8. For closure capacity only, predeclare exactly two new independent paired
   holdouts, attempt all six A/B/C cells, combine them with the original
   evidence, and apply the frozen decision without optional stopping.
9. For the final closure attempt, freeze and execute five neutral runtime
   health canaries before any new holdout. The canaries are disposable,
   candidate-independent, and do not contribute to value metrics. A gate of
   at least 4/5 valid requests, no systematic timeout pattern, no auth
   failure, and no harness failure is required before considering any further
   action; a known inadequate timeout policy independently invalidates the
   current experiment contract.
