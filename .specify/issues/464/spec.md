# Issue 464 — Source identity/content validation

## Scope

Validate the twelve unresolved source names from Issue #447 using GitHub
installation/org search, historical `xxammaxx` references, local remotes and
local repository/worktree evidence. Source repositories are read-only.

## Acceptance

- Every requested name has one complete evidence row.
- Located identities are recorded without inventing mappings.
- Missing identities are explicitly `NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH` with
  search surfaces recorded.
- Unique assets are migrated, or explicitly rejected with rationale.
- No source mutation, secret copy, second control plane, DeepSeek agent use or
  paid model call.
