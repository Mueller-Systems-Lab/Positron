# Issue #250 route smoke

The route smoke harness reuses the repository's Playwright configuration and produces untracked artifacts under `test-results/route-smoke/`.

## Local mode

With no target variable, Playwright starts the existing fake-mode server and Vite web server:

```bash
npm run test:route-smoke:unit
npm run test:route-smoke
```

The local run uses `http://localhost:5173/`. If the local database has no run, the harness uses the existing authenticated demo-run endpoint to create one test fixture. The test token is never printed or written to evidence.

## Explicit external mode

Supply the complete origin explicitly:

```bash
POSITRON_ROUTE_SMOKE_BASE_URL=https://target.example.test npm run test:route-smoke
```

The URL must be absolute, use HTTP(S), contain no credentials/query/fragment, and target the origin root. In this mode Playwright does not start local servers and never falls back to localhost. The harness performs read-only fixture discovery; `/runs/:id` is skipped with a reason when the target has no existing run.

`POSITRON_ROUTE_SMOKE_BASE_URL` identifies the target as an external target, but it does not by itself prove that the target is CT-120. A CT-120 result may be classified `CT120_PROVEN` only when an operator supplies and identifies a reachable CT-120 target and the complete eligible route evidence passes. Without that target, the honest status is `CT120_NOT_AVAILABLE`.

## Checks and artifacts

Each named route is checked for:

- a successful document response with HTTP status 200;
- a visible stable heading signal;
- no not-found page, blank body, or blank `#root`;
- zero uncaught page errors and zero application console errors;
- one sanitized route screenshot.

The route manifest is compared with `apps/web/src/App.tsx`; drift fails the suite. The artifact manifest records `targetSource`, redacted target URL, mode, discovered/tested/skipped routes, skip reasons, screenshot paths, page errors, and console errors. Raw query strings and credentials are rejected before navigation. Screenshot files remain transient artifacts; review them for application data before sharing externally.

The existing `npm run test:e2e` suite and advisory CI job are unchanged. CT-120 is not a normal CI dependency and no CT-120 secret is added.
