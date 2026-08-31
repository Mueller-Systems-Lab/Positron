# Issue #465 — Release-hardening specification

## Initial release scope

Supported: fake/dry-run operation, supervised bounded Real Mode as documented by
#308, and self-hosted control-plane operation. Unsupervised Real Mode,
unproven production autonomy, and automatic source retirement remain disabled.

The release gate covers reproducible installation, durable state migration and
backup/restore, restart recovery, persistent fenced mutation authority, and
documented CLI/API/configuration/upgrade contracts.

## Contract

All durable mutation authority is stored in the existing control-plane SQLite
database. A resource has at most one active fenced owner. Unknown or ancient
schemas fail closed with an actionable error. Local E2E owns isolated server
ports and never reuses an unrelated process.
