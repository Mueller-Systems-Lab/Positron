# Migration validation

Existing additive control-plane migrations support the canonical historical
P4 fixture and are idempotent; historical attempt fields remain unchanged and
profile fields are not invented. Evidence: `p5.1-migration.test.ts`.

Forward migration and idempotency are PASS for the covered fixtures. Ancient
schemas without the canonical tables remain unsupported and must be rejected
by the operator runbook before opening the service; broader fixture coverage is
still pending.
