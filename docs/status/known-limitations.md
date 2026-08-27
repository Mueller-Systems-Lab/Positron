# Known Limitations

**Status date:** 2026-08-26
**Baseline:** `a7a33596d45343eb0bf4a429ac6d487fc9fd8b61`

This page describes current limitations only. Historical counts and incident reports remain in dated evidence.

| Limitation | Status | Follow-up |
| --- | --- | --- |
| Productive Full Real Mode is not generally validated | OPEN / GATED | [#308](https://github.com/Mueller-Systems-Lab/Positron/issues/308) |
| Repo-wide Biome correctness backlog may still exist despite formatting gates | OPEN / TRACKED | [#340](https://github.com/Mueller-Systems-Lab/Positron/issues/340) is closed as a historical cleanup track; inspect current CI for new findings |
| Root Docker Compose is advanced and requires explicit secrets/host integrations | DOCUMENTED | Use the fake/demo quickstart for first runs |
| Admin routes require an admin token when enabled | DOCUMENTED | Quickstart generates a local ignored token |
| Browser voice output depends on local Web Speech API support | DOCUMENTED | Voice is optional and browser-local |
| Real GitHub/OpenCode/SpecKit operations can have external side effects | SAFETY GATE | Configure only in an isolated, supervised environment |

## Not current limitations

Issues #250, #402, #416, and #421 are closed. Their evidence remains useful, but their old open-backlog wording and fixed QA snapshots must not be copied into current status prose. The former Playwright tracing issue #304 is also closed.

## Safety boundary

Do not infer production readiness from a passing fake/demo run. The default posture remains fake adapters, disabled push/merge, and an active merge kill switch.
