# Issue #469 Specification

Reconcile historical release-candidate notes with the current `0.1.0`
development-version contract without changing package versions or publishing
any artifact.

## Acceptance criteria

- Historical RC notes are explicitly marked as historical.
- No current document claims the historical per-component versions as current.
- `package.json`, changelog, release notes, and upgrade documentation agree that
  `0.1.0` is an unreleased development candidate.
- No tag, release, deployment, or package publication is performed.
