# Issue #487 — Release Plan

1. Lock local/GitHub reality and capture the foreign-work boundary.
2. Audit manifests, lockfile, runtime version surface, release docs, and historical exceptions.
3. Prepare only release metadata, notes, changelog, living-doc status, and evidence.
4. Run preparation validation and disposable fresh-install proof.
5. Run full qualification and architecture/security/release reviews; record evidence.
6. Run the final visible headed Playwright and onboarding E2E gate.
7. Commit, push, create the release PR, and watch checks/reviews.
8. Land only through the fail-closed exact-head process after explicit per-PR confirmation.
9. Requalify fresh canonical main, freeze the exact release commit, create and verify the annotated tag.
10. Publish the stable GitHub Release, independently verify tag/release/main, run tag-clone smoke, update final evidence, and close #487.

Any failed gate is recorded in GitHub and blocks publication until resolved; after three unsuccessful fix loops, stop.
