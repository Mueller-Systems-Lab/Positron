# Specification: Organization-transfer reconciliation

## Problem

The Positron repository moved from `xxammaxx/Positron` to
`Mueller-Systems-Lab/Positron`. Current-facing links, operational defaults,
site metadata, and repository configuration must describe the new canonical
organization without falsifying archived evidence.

## Invariant

- CURRENT references point to `Mueller-Systems-Lab/Positron`.
- CURRENT Pages references point to
  `https://mueller-systems-lab.github.io/Positron/`.
- HISTORICAL references remain exactly truthful to the repository owner at the
  time the evidence was produced.
- `HISTORICAL_TRUTH_MUTATIONS = 0`.

## Scope

1. Audit tracked repository text and classify old-owner references as current
   canonical, current operational, historical evidence/release/sandbox,
   generic example, test fixture, or ambiguous.
2. Update current README, install/status/governance/security documentation,
   scripts, source defaults, tests that assert current behavior, workflows,
   agent configuration, badges, and Pages metadata.
3. Add a deterministic transfer regression check over current-facing paths.
4. Record the inventory, evidence, test results, reviewer participation, and
   post-merge live Pages verification.

## Non-goals

- No product or provider changes.
- No dependency upgrades.
- No changes to Issue #308 or reopening Issue #211.
- No history rewrite, release, tag, production deployment, or direct main push.
- No mutation of archived evidence solely because GitHub redirects old URLs.

## Acceptance criteria

- No stale old-owner or old-Pages references remain in current-facing paths.
- Historical evidence remains semantically unchanged.
- Repository, clone, Pages, README, install, status, governance, script,
  workflow, badge, robots, sitemap, and metadata checks pass.
- All configured independent reviewers run with unique child sessions and
  read-only mutation boundaries; DeepSeek usage is zero.
- Local and remote gates pass, the PR lands at the exact frozen head, Pages
  redeploys, and the transfer issue is closed with evidence.
