# Issue #211 — GitHub Pages Live Verification

**Pages URL:** https://xxammaxx.github.io/Positron/
**Verified:** 2026-08-26
**Deployment run:** `32964885893` (post-repair deployment; prior successful run `32964161261`)
**Deployment result:** Build PASS, Deploy PASS

The URL was returned by the GitHub Pages API after enabling `build_type=workflow`.
The repository homepage was set to this exact URL only after the browser check
below passed.

| Check | Result |
| --- | --- |
| HTTP response | PASS — 200 |
| Hero visible | PASS |
| CSS loaded | PASS |
| Screenshot resources | PASS — 4 images loaded |
| Navigation/link inventory | PASS — 14 links, valid anchors and GitHub destinations |
| Desktop viewport | PASS — 1440px, no horizontal overflow |
| Mobile viewport | PASS — 390px, no horizontal overflow |
| Browser console | PASS — 0 errors |
| Mixed content / 404 response scan | PASS |
| Canonical, OpenGraph URL, robots, sitemap | PASS — included after URL verification |

The first merge-triggered Pages run failed with a GitHub API 404 because the
workflow started before enablement became visible. It was rerun unchanged after
enablement and completed successfully. A later live check found a desktop grid
overflow in the install terminal; PR #451 added `min-width: 0` to the grid
children. The post-repair deployment and live check above are the final truth.
