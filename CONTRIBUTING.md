# Contributing

Thank you for contributing to Positron.

## Source of Truth

Use the current `main` branch, GitHub issues, pull requests and evidence files as source of truth. Do not rely on stale chat context.

## Local Gates

Before opening or updating a PR, run:

```powershell
git diff --check
npx biome format .
npm run build
npm run typecheck
npm test
```

`npx biome check .` is currently advisory-only because a known lint backlog exists ([#340](https://github.com/Mueller-Systems-Lab/Positron/issues/340)).

## CI Gates

GitHub Actions Quality Gates are required for merge to `main` (6 required checks: `format-check`, `differential-lint`, `build`, `typecheck`, `unit-tests`, `observability-config-check`). See [CI Policy](.opencode/policies/ci-policy.md) for details.

## Label Convention

See [docs/governance/LABELS.md](docs/governance/LABELS.md) for the label taxonomy, priority model, approval rules, and AI autonomy boundaries.

## Pull Request Rules

- Keep PRs small and scoped.
- Include evidence for local gates.
- Do not include build artifacts, lockfile changes or dependency changes unless explicitly scoped.
- Do not use `git stash apply`, `git stash pop` or `git stash drop` without explicit approval.
- Do not trigger GitHub-CI manually without explicit approval.
- Do not merge without human approval.

## Workspace Rules

Use `C:\Positron` as the normal project root. Do not create sibling worktrees or sibling folders.
