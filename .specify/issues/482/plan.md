# Issue 482 — Plan

1. Define the versioned read-only readiness contract beside the existing
   readiness authority and compose it from existing checks.
2. Add `GET /api/operator-readiness` without changing mutating routes.
3. Add a dashboard readiness panel and navigation entry that only projects the
   response and links to safe configuration surfaces.
4. Add backend contract, UI, and disposable journey coverage.
5. Update current truth and the small v0.2 roadmap, then run the complete
   validation contract and visible headed Playwright last.
