# Issue 491 Review Gate

This gate defines the evidence required before the installed supervised
onboarding scope is considered qualified. It is subordinate to `spec.md`,
`plan.md`, and `tasks.md`; it does not claim release publication or merge
authority.

## Required checks

- The installed launcher exposes `configure supervised`,
  `doctor --supervised`, and explicit supervised lifecycle commands.
- Configuration, token storage, generated runtime secrets, symlink targets,
  permissions, input validation, and output redaction are verified.
- Quickstart remains the safe default and supervised state/volumes remain
  isolated from it.
- Doctor is read-only and validates the installed contract and host readiness.
- Missing or invalid token, repository, provider, model, OpenCode, and SpecKit
  inputs fail with structured actionable diagnostics and no secret disclosure.
- The installer fixture works from a path containing spaces, preserves user
  state, rejects unsafe archives, and leaves no runtime secret environment
  file after stop.
- Required repository validation, architecture review, security review, and
  product E2E evidence are current for the candidate content.

## Evidence rule

Each check must map to executable tests or a versioned evidence artifact. A
passing command alone is not acceptance evidence when the command reports
partial or missing criteria. Release qualification, tag publication, and
public-install acceptance remain the separate Issue 493 scope.
