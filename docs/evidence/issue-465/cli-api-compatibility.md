# CLI/API compatibility

There is one supported public CLI command: `positron run --issueNumber <n>`.
`--repoId`, `--autonomyLevel 0..2`, and `--serverUrl` are optional. `--help`
exits 0; invalid arguments and transport/API failures exit 1, with diagnostics
on stderr and no secret values. There are no stable `health`, `runs`, `stats`,
or `cancel` CLI commands; those names are not advertised.

The stable HTTP contract is deliberately read/projection-oriented:
`GET /api/health` (process alive), `GET /api/readiness` (durable state ready),
`GET /api/repos`, `GET /api/projects`, `GET /api/runs`, `GET /api/runs/:id`,
`GET /api/evidence`, and `GET /api/settings/*`. Mutating routes require the
Bearer/X-Admin-Token admin contract. Authentication failures are 401/503,
validation failures 400, missing resources 404, and successful JSON responses
are tested through the existing integration suite. Internal scheduler,
evolution, metrics, and demo routes are not public-stable compatibility
promises.

`cli-contract.test.ts`, `readiness-contract.test.ts`, and the existing route
integration tests provide deterministic argument/status/error coverage.
