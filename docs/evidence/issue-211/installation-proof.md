# Issue #211 — Installation Proof

The demo path was exercised in an isolated clean worktree created from the
current `origin/main` lineage. The verification sequence was:

1. `./scripts/quickstart.sh --dry-run`
2. `./scripts/quickstart.sh`
3. `curl -fsS http://localhost:5173/api/health`
4. `npx playwright test e2e/route-smoke.spec.ts --workers=1`
5. repeat `./scripts/quickstart.sh`
6. `./scripts/quickstart.sh --status`

No environment file was edited manually and no GitHub token, OpenCode binary,
SpecKit installation, or host Redis service was required. The verified UI URL
was `http://localhost:5173/`; the verified health route was
`http://localhost:5173/api/health`.

The browser route suite passed 9/9 routes, including a locally generated demo
fixture for `/runs/:id`. The generated credentials stayed in the ignored
`.positron/quickstart/` directory and were never printed or included in an
artifact.
