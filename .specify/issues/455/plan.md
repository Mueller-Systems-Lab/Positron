# Plan: Organization-transfer reconciliation

1. Refresh live repository, Pages, branch-protection, issue, and PR state;
   record the start SHA and repository identity.
2. Build an exhaustive old-owner/Pages-reference inventory and classify every
   match before editing.
3. Update only current canonical and operational references, site metadata,
   regression coverage, and this issue's evidence; preserve historical files.
4. Run the configured 17 read-only reviewers and all repository-supported
   format, lint, build, type, unit, E2E, link, secret, artifact, and transfer
   checks.
5. Commit exact paths, push normally, create one PR, observe required CI and
   review state, and freeze the exact PR head.
6. Merge with the expected frozen head using the normal protected merge path;
   verify main inclusion and Pages build/deploy/live SEO and asset behavior.
7. Post the complete acceptance matrix to Issue #455 and close it as
   completed; verify #211 remains closed and #308 remains open and unchanged.
