# Issue 484 — Plan

1. Preserve the fresh-main and fresh-clone evidence, inventory the existing
   doctor/quickstart/configuration surfaces, and freeze the v1 output contract.
2. Refactor only `scripts/doctor.sh` into a read-only scoped checker with
   human and JSON renderers, stable reason codes, exit semantics, and safe
   environment handling.
3. Add shell-level regression coverage for demo/supervised checks, negative
   prerequisite cases, port conflicts, idempotency, and security boundaries.
4. Update getting-started, install, current-capabilities, known-limitations,
   and the v0.2 roadmap to mirror the proven commands and boundaries.
5. Re-run the documented quickstart in a newly cloned workspace, run focused
   and full quality gates, perform architecture/security/product reviews, and
   run headed Playwright last.
