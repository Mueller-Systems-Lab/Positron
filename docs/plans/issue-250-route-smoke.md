# Issue #250 — Implementation Plan

1. Add pure route-smoke target validation, route manifest data, App-route drift extraction, fixture URL resolution, error classification, blank-page detection, and screenshot-name sanitization under `e2e/support/`.
2. Add focused unit tests for malformed targets, credential/query rejection, local-vs-external mode, no silent fallback, manifest completeness, route resolution, and browser error/blank-page helpers.
3. Extend `playwright.config.ts` so the explicit external target changes `baseURL` and disables local `webServer`; leave the existing local lifecycle and all existing projects unchanged when the variable is absent.
4. Add the route-by-route Playwright smoke spec with document-response, semantic signal, page-error, console-error, blank-screen, not-found, and screenshot checks. Resolve `/runs/:id` only from real API state, with local-only demo fixture setup.
5. Document invocation, output fields, CT-120 classification, screenshot handling, and CI behavior in `docs/testing/`.
6. Run focused tests, route smoke local mode, the existing Playwright suite, repository gates, and a secret/diff audit. Record evidence in Issue #250 and the PR.
