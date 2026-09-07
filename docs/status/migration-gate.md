# Canonical migration gate

This gate is intentionally local-first. It does not imply that the historical
public source repository was changed or that a target company repository was
created.

Required assertions are checked by `npm run verify:canonical-boundary`, the
build, focused onboarding tests, and the migration manifest. Remote GitHub
mutation remains operator-gated and merge is prohibited by this migration.
