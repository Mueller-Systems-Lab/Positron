# Hard-gate qualification evidence

`.gates/self-test.sh` ran all required controls in a disposable temporary Git
fixture. The controls covered G40-before-G30, default-branch protection,
out-of-scope and pre-existing-user-work rejection, failing targeted/full/E2E
validation, tracked/untracked/Evidence mutation invalidation, commit admission
and content equivalence, executable browser readiness, environment-variable
spoof rejection, paid-CI rejection, direct GitHub API/`gh` mutation rejection,
and the complete happy path.

Result: T01–T19 PASS; `HARD_GATES_ADMITTED=YES` was produced by the self-test.
