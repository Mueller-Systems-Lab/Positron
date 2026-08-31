# Configuration and environment contract

Required configuration is `POSITRON_REPO_OWNER` and `POSITRON_REPO_NAME` for
server operation, plus `POSITRON_ADMIN_TOKEN` for authenticated mutation
routes. `POSITRON_DB_PATH` is optional (the packaged local DB default is used).
Modes default to fake: `POSITRON_GITHUB_MODE`, `POSITRON_SPECKIT_MODE`, and
`POSITRON_OPENCODE_MODE`. Push and merge default disabled; the merge kill
switch defaults active. Real/supervised paths require explicit configuration
and approval. `GITHUB_TOKEN`, `GH_TOKEN`, `POSITRON_ADMIN_TOKEN`, research and
stage-3 credentials are SECRET=YES and are never emitted in evidence.

Operational tuning variables include `POSITRON_ATTEMPT_LEASE_TTL_MS`,
`POSITRON_WORKSPACE_LOCK_TTL_MS`, `POSITRON_PROVIDER_CAPACITY`, scheduler
limits/interval, CORS, log level, watcher, and adapter model settings. Invalid
numeric/JSON lease and capacity values fail closed. Changes to DB path, mode,
credentials, workspace root, or scheduler require restart; log-level and
watcher tuning do not.

| Gate | Result |
|---|---|
| UNDOCUMENTED_REQUIRED_CONFIG | 0 |
| PUSH_DEFAULT / MERGE_DEFAULT | DISABLED |
| UNSUPERVISED_REAL_MODE_DEFAULT | DISABLED |
| MISSING_REQUIRED_AUTH / APPROVAL / LOCK_AUTHORITY | FAIL_CLOSED |
| SAFE_DEFAULTS / CONFIG_CONTRACT | PASS |
