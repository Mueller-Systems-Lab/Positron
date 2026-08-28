# Issue #308 — Phase 4 failure-mode matrix

Generated: 2026-08-28.

Phase 4 is authorized only after a successful Phase 3. Because Phase 3 was
not started, the real canonical denial, timeout, workspace-lock, missing-env,
and interception-canary runs are `NOT RUN`. No external effect was generated
by any Phase 4 test in this execution.

| Case | Result | External mutations |
|---|---|---:|
| Denial before pre-write | NOT RUN | 0 |
| Approval/lease timeout | NOT RUN | 0 |
| Competing workspace lock | NOT RUN | 0 |
| Missing environment/credential | NOT RUN | 0 |
| In-run denial canary | NOT RUN | 0 |
