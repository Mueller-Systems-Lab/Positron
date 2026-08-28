# Issue #308 — reviewer lifecycle ledger

Generated: 2026-08-28. Reconciled against the prior runtime evidence and
current PR #460 continuation. The source fixes below are not yet represented
by a frozen final review head.

## Accounting rule

`SPAWN_ATTEMPTED`, `SPAWNED`, `COMPLETED`, `RESULT_CAPTURED`, and `COUNTED`
are distinct states. A session counts only when its role, unique session,
target, independent execution, structured result, and findings are all
available. A closed session without a captured result does not count.

## Reconciled totals

| Metric | Value |
|---|---:|
| PLANNED | 17 |
| SPAWN_ATTEMPTED | 31 known collaborator attempts |
| SPAWNED | 19 known |
| COMPLETED | 11 known |
| RESULT_CAPTURED | 11 known |
| COUNTED (role-qualified historical/current-target results) | 7 |
| CURRENT_HEAD_COUNTED (current continuation) | 0 pending fresh review wave |
| UNIQUE_COUNTED_SESSION_IDS | 7 |
| CHILD_BACKEND_COMPLETED | 11 |
| ISOLATED_BACKEND_COMPLETED | 0 |
| SPAWN_FAILURES | 12 known |
| TIMEOUTS | 0 classified |
| CRITICAL | at least 2 across captured results |
| MAJOR | at least 20 across captured results |
| DEEPSEEK | 0 |

The initial six completed results were recovered from the runtime transcript
and mapped to the first six requested roles by original wave order and
matching findings. Five later duplicate-role results are retained as
captured evidence but are not double-counted. The later wave was observed
before the final lint-only head change, so it does not satisfy the
current-head final-review gate.

## Role ledger

| Required role | SPAWN_ATTEMPT | SESSION_ID | TARGET | SPAWN_STATUS | COMPLETION | RESULT_CAPTURED | VERDICT | COUNTED |
|---|---|---|---|---|---|---|---|---|
| audit-repository-reality | yes | `01a04660-4d8d-7ca3-aa2c-8dd37f48a265` | e917ba6 | spawned | completed | yes | BLOCKED/AMBER | yes (historical) |
| audit-repository-hygiene | yes | `01a04660-4e06-7cc2-8197-2428a9cb9fae` | e917ba6 | spawned | completed | yes | BLOCKED | yes (historical) |
| review-architecture | yes | `01a04660-4e42-7362-ae83-39aae0823480` + fresh `01a0467d-6767-7d12-8b27-5890639ba8a2` | e917ba6 / 6ad9013 | spawned | historical completed; fresh stalled/shutdown | historical yes; fresh no | REJECT / no fresh verdict | yes (historical) |
| review-security | yes | `01a04660-4e7c-78c0-967b-7f34a299728d` + fresh `01a0467d-6797-7173-8021-77a9a5e931f4` | e917ba6 / 6ad9013 | spawned | historical completed; fresh stalled/shutdown | historical yes; fresh no | NO-GO / no fresh verdict | yes (historical) |
| review-devex-installer | yes | `01a04660-4eba-7950-8128-a0493ccf0cb9` | e917ba6 | spawned | completed | yes | BLOCKED | yes (historical) |
| review-docker-infrastructure | yes | `01a04660-4eff-76b0-bda0-4e472a4fc87f` | e917ba6 | spawned | completed | yes | BLOCKED | yes (historical) |
| review-frontend-landing | yes | `01a04668-cc38-7d11-9a52-b63d1fda752a` | 67028d7 | spawned | completed | yes | NOT_APPLICABLE / PASS | yes (historical) |
| review-ux-accessibility | yes | `01a0467d-67d3-7fc3-8107-2e6a9c122244` | 6ad9013 (pre-ledger) | spawned | stalled/shutdown | no | no result | no |
| review-visual-qa | yes | `01a0467d-680c-7880-b494-9f407245c6ba` | 6ad9013 (pre-ledger) | spawned | stalled/shutdown | no | no result | no |
| review-documentation-truth | yes | `01a04681-da62-7f81-92c3-145afe63f38f` + isolated fallback | 6ad9013 / 58990b5 | spawned/fallback attempted | stalled/shutdown; fallback no structured result | no | no result | no |
| review-github-pages | yes | `01a04681-da96-7c70-9e56-2188df116fac` | 6ad9013 (pre-ledger) | spawned | stalled/shutdown | no | no result | no |
| review-test-tooling | yes | `01a04681-dad2-71c1-90b8-7cf087acbdf0` | 6ad9013 (pre-ledger) | spawned | stalled/shutdown | no | no result | no |
| review-integration | yes | `01a04681-db0c-7cf1-b265-4b34f619681f` | 6ad9013 (pre-ledger) | spawned | stalled/shutdown | no | no result | no |
| review-release-packaging | historical attempt | unrecovered | unknown | unknown | unknown | no | N/A | no |
| review-governance | historical attempt | unrecovered | unknown | unknown | unknown | no | N/A | no |
| research-official-docs | historical attempt | unrecovered | unknown | unknown | unknown | no | N/A | no |
| review-independent-final | not started (must run last) | — | — | — | — | no | blocked by prerequisites | no |

## Duplicate and failed waves

These results are captured and retained but do not add a second count to an
already covered role:

- `01a04668-c744-71e1-b2c5-ed63dd92a1cf` — reality, completed, blocked;
  reviewed the pre-`6ad9013` head.
- `01a04668-c8e7-7510-986b-28b0b07eba98` — hygiene, completed, not approved;
  reviewed the pre-`6ad9013` head.
- `01a04668-c993-74f0-a6ef-e594a086e687` — DevEx, completed, blocked;
  reviewed the pre-`6ad9013` head.
- `01a04668-ca91-7b81-9405-ea2eee40cda3` — Docker, completed, blocked;
  reviewed the pre-`6ad9013` head.
- `01a04668-cc38-7d11-9a52-b63d1fda752a` — frontend/landing, completed,
  not applicable; reviewed the pre-`6ad9013` head.
- `review-ux-accessibility` in the first recovery attempt was a spawn
  failure; it has no session and counts zero.

The earlier evidence statement “0/17; every spawn failed” is superseded by
this ledger. It was false as a description of the later runtime transcript,
but no success is inferred from sessions without results.

## Captured finding dispositions

These are dispositions of recovered historical results only; they do not
count as final-head reviews.

| ROLE / SESSION | HEAD | FINDING | SEVERITY | STATUS |
|---|---|---|---|---|
| audit-repository-reality / `01a04660-4d8d...` | e917ba6 | snapshot-only authority; lock owner unchecked; productive bootstrap absent; Phase 4 absent | C/M | FIXED (current continuation) |
| audit-repository-hygiene / `01a04660-4e06...` | e917ba6 | manifest hash and fixture drift; historical commit label; evidence incompleteness | M | FIXED / PRE_EXISTING_OUT_OF_SCOPE |
| review-architecture / `01a04660-4e42...` | e917ba6 | productive wiring absent; snapshot revalidation; live path trust gap | C/M | FIXED (current continuation) |
| review-security / `01a04660-4e7c...` | e917ba6 | unbound/self-attested approval; injected executor trust; credential/denylist concerns | M | FIXED (binding/bootstrap) / PRE_EXISTING_OUT_OF_SCOPE (credential not available for Phase 3) |
| review-devex-installer / `01a04660-4eba...` | e917ba6 | helper expiry mismatch; productive wiring absent; package-script and Docker concerns | M | FIXED / PRE_EXISTING_OUT_OF_SCOPE |
| review-docker-infrastructure / `01a04660-4eff...` | e917ba6 | productive wiring absent; reservation run binding; runtime/container isolation concerns | C/M | FIXED (wiring/reservation) / PRE_EXISTING_OUT_OF_SCOPE (container baseline) |
| review-frontend-landing / `01a04668-cc38...` | 67028d7 | no applicable frontend surface; verify presentation/status truth | minor | PRE_EXISTING_OUT_OF_SCOPE / N/A with evidence |
| audit-repository-reality / `01a04668-c744...` | 67028d7 | snapshot-only authority; productive wiring and Phase 4 absent | C/M | FIXED (current continuation) |
| audit-repository-hygiene / `01a04668-c8e7...` | 67028d7 | worktree/head drift and historical evidence concerns | M | FIXED / PRE_EXISTING_OUT_OF_SCOPE |
| review-devex-installer / `01a04668-c993...` | 67028d7 | stale review instructions; quickstart/install and count drift | M | PRE_EXISTING_OUT_OF_SCOPE |
| review-docker-infrastructure / `01a04668-ca91...` | 67028d7 | compose token/build-context/mount/network concerns | M | PRE_EXISTING_OUT_OF_SCOPE |

No recovered historical result is silently deleted. A finding remains
`STILL_BLOCKING` until the current implementation or current evidence proves
the disposition; the only remaining implementation blockers before the final
review wave were B1/B2/Phase 4 and they now have focused tests.

## Gate status

The ledger is incomplete: 17 current-head completed results do not exist.
No reviewer PASS, remediation readiness, Phase 3 readiness, merge, or Issue
#308 closure is claimed.
