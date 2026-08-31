# Issue #465 — Plan

1. Refresh reality from canonical main and define the first-release scope.
2. Make local Playwright server lifecycle hermetic.
3. Add persistent fenced external-mutation leases to the existing SQLite
   control plane and compose them with workspace authority.
4. Validate migration, backup/restore and restart behavior with deterministic
   fixtures.
5. Reconcile version/config/CLI/API/upgrade contracts and publish evidence.
6. Run the complete release matrix, freeze the candidate and open (but do not
   merge) the dedicated PR.
