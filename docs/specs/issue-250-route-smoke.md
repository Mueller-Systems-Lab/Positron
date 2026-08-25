# Issue #250 — Portable Browser Evidence Route-Smoke Harness

## Status

Rescoped specification, based on `origin/main` at `3b6a85530cf3804f1df51b7637d4187d67c2e6fd`.

## Current reality

- `apps/web/src/App.tsx` defines nine named routes and one catch-all route.
- The historical ten-route claim is stale.
- Existing Playwright coverage remains in place and is not a route-by-route CT-120 contract.
- No canonical CT-120 host, URL, availability probe, or CI secret is present.

## Goal

Add a portable route-smoke capability to the existing Playwright harness. It must run against the self-started local Positron instance or against an explicitly supplied remote base URL, without changing product behavior or making private infrastructure a normal CI dependency.

## Contract

The optional `POSITRON_ROUTE_SMOKE_BASE_URL` environment variable selects an external target. It must be an absolute `http` or `https` URL without credentials, query parameters, or fragments. If it is absent, the existing Playwright `webServer` lifecycle starts the local target at `http://localhost:5173`. A supplied remote value never falls back to localhost.

The harness reports target source, mode, and a redacted target URL in its untracked Playwright artifact manifest. It does not log credentials or the raw environment value.

## Route manifest

The test-side manifest records, for each named application route:

- route pattern and deterministic smoke URL;
- whether a fixture is required;
- a stable semantic page signal;
- a sanitized screenshot name;
- special setup.

The manifest is checked against the static route declarations in `apps/web/src/App.tsx`, excluding the catch-all. Drift fails the route-smoke suite before route execution.

`/runs/:id` resolves to the first real run returned by `GET /api/runs?limit=1`. Local mode may create one existing test demo run through the already-supported authenticated demo endpoint when the local database is empty. External mode does not write to the target and reports the parameterized route as skipped when no run exists.

## Per-route acceptance

For each executed route the test checks:

1. browser document navigation returns a non-null HTTP 200 response;
2. the route does not render the not-found page;
3. there are no uncaught `pageerror` events;
4. there are no application `console.error` events;
5. the application root/body contains meaningful text;
6. the route-specific semantic signal is visible;
7. a route-level screenshot is captured using the manifest filename.

The HTTP assertion is specifically the document response returned by `page.goto`; it is not inferred from DOM state.

## Evidence and CI

Local and external results are emitted to ignored Playwright artifacts under `test-results/route-smoke/`. Screenshots are not committed. An external run is CT-120 proof only when the supplied target is explicitly identified as CT-120 by the operator and all eligible route checks and screenshots pass. No CT-120 target is assumed by this implementation. The existing advisory E2E CI job remains self-contained and is not made dependent on CT-120.

## Out of scope

No production route changes, controller/provider/auth/scheduler changes, UI redesign, deployment, release, #211, #308 Phase 3/4, or DeepSeek usage.
