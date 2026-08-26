# Implementation Plan: Repository Polish, Easy Install, and GitHub Pages

**Issue:** #211
**Base:** `a7a33596d45343eb0bf4a429ac6d487fc9fd8b61`

## Design principles

1. Keep the controller/worker architecture unchanged.
2. Separate current living documentation from dated evidence.
3. Make fake/demo mode the only quickstart default.
4. Preserve the existing advanced Compose path for real integrations, while removing its ambiguity from first-visit docs.
5. Keep the landing page dependency-free and project- Pages-base-path safe.
6. Deliver in vertical PRs so each change is reviewable and reversible.

## Vertical slices

### PR A — Repository truth and hygiene

- Add Issue #211 spec, plan, tasks, reality audit, agent inventory, cleanup manifest, and acceptance ledger.
- Reconcile README, `.env.example`, living status docs, install docs, architecture links, and metadata claims against current main.
- Keep historical release/evidence files historically truthful; add archive guidance instead of rewriting them.
- Update root prompt/reference classification only where a stable relative link and no runtime dependency are proven.

### PR B — Easy install and demo runtime

- Add `docker-compose.quickstart.yml` with fake GitHub/SpecKit/OpenCode, no host-tool mounts, internal Redis, and generated admin/Redis credentials.
- Add idempotent `scripts/quickstart.sh`, `scripts/quickstart.ps1`, and lightweight doctor commands.
- Add installer tests/dry-run checks and fresh-clone evidence.
- Document advanced Compose separately and record the original clean-clone failure.

### PR C — Landing, screenshots, and Pages

- Capture fresh current demo screenshots under `docs/assets/screenshots/`.
- Add dependency-free `site/` HTML/CSS/assets with honest claims and `/Positron/`-safe relative links.
- Add local static validation and Playwright coverage for desktop/mobile, keyboard focus, asset loading, and console errors.
- Add Pages workflow using official actions with immutable commit pins and PR-safe triggers.
- After merge, enable Pages, deploy from `main`, verify the returned URL live, and then update repository homepage.

## Architecture review decision

**Selected:** dedicated quickstart Compose file. A separate file is the smallest safe boundary because fake mode must not inherit host mounts or mandatory secret interpolation from the existing full-stack file. The advanced file remains available for operators who explicitly configure real integrations.

**Architecture role:** PASS, pending implementation checks.
**Security role:** default must remain fake, push/merge disabled, kill switch enabled, credentials generated locally and ignored.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Documentation repeats stale numbers | Use dynamic CI links and dated evidence snapshots only. |
| Quickstart accidentally enables real mode | Hard-code fake modes in the quickstart Compose file and scripts; no token/tool mounts. |
| Generated credentials enter Git | Store only in `.positron/quickstart/`, ignore the directory, and scan status/output. |
| Project Pages asset 404s | Use relative URLs, local base-path validation, and live Playwright checks. |
| Landing claims drift | Maintain `landing-claims-matrix.md` with source and SHA for every factual claim. |
| Existing dirty worktree contaminates PR | Work only in the clean issue worktree based on `origin/main`; stage explicit paths. |

