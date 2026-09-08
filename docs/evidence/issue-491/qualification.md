# Issue #491 qualification evidence

The installed supervised onboarding implementation is present on the current
candidate through the Issue #492 merge lineage. The fixture test covers the
launcher, secure configuration/token storage, permissions, secret redaction,
safe repository/provider validation, symlink rejection, doctor behavior, and
demo-state preservation. The source contract is `.specify/issues/491/spec.md`;
the live Issue #491 is closed and its product PR is already merged.

Acceptance mapping:

- launcher commands and versioned config: `scripts/supervised.sh`,
  `scripts/installer-test.sh`
- protected config/secrets and redaction: `scripts/supervised.sh`, installer
  permissions and output assertions
- safe demo/supervised profile separation: `scripts/quickstart.sh`,
  `scripts/supervised.sh`, installer state-link assertions
- read-only doctor/readiness contract: `scripts/supervised.sh`,
  `apps/server/src/__tests__/install-doctor.test.ts`
- invalid token/repository/provider and symlink paths: installer negative cases
- architecture/documentation: `docs/architecture/README.md`, `docs/install/`,
  `docs/status/`, and current README
