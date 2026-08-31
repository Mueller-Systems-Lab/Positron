# Migration validation

Existing additive control-plane migrations support the canonical historical
P4 fixture (V1–V6) and are idempotent; historical attempt fields remain
unchanged and profile fields are not invented. The current migration ledger is
V11 and is written only after shape validation. Evidence:
`p5.1-migration.test.ts` and the backup fixture.

Forward migration, idempotency, database integrity, and legacy preservation are
PASS for the supported V1–V6 fixture. Ancient schemas without the canonical
tables remain unsupported and fail readiness; they must not be opened as an
empty control plane. Migration is additive and does not reset approval
consumption, duplicate reconciliation, or grant mutation authority.
