# 01 — Real Defect Reconstruction

**Run ID:** 20260808_220525-harden
**Date:** 2026-08-09T01:11Z

## Defect A: SpecKit Artifact Scanner — Missing `.positron/artifacts/` paths

### Observed Symptom
Real-mode pipeline ran OpenCode (`spec-driven-development`) for specify/plan/tasks phases.
OpenCode produced output (168-421 chars of extracted text) and saved artifact files to
`.positron/artifacts/specify.md`, `.positron/artifacts/plan.md`, `.positron/artifacts/tasks.md`
(and `speckit.specify.md`, `speckit.plan.md`, `speckit.tasks.md` variants).
The artifact scanner (`scanWorkspace`) only looked in known paths (`spec.md`, `specs/SPEC.md`,
`.specify/spec.md`, etc.) but NOT in `.positron/artifacts/`.
Result: `runSpecify`/`runPlan`/`runTasks` returned with 0 spec/plan/tasks artifacts detected.

### Exact Failing Phase
REVIEW — `missing artifacts: spec, plan, tasks`

### Root Cause
The `scanWorkspace` function in `packages/speckit-adapter/src/artifact-scanner.ts` had a
fixed list of known paths per artifact kind. The `.positron/artifacts/` directory created by
`RealOpenCodeAdapter.runSlashCommand()` was not in this list.

### Affected Code Path
```
RealOpenCodeAdapter.runSlashCommand()
  → saves artifact to .positron/artifacts/<phaseName>.md
RealSpecKitAdapter.runSpecify() / runPlan() / runTasks() [artifact-only mode]
  → agentSlashCommandResult()
    → filterArtifactsForPhase()
      → scanWorkspace()  ← looks at knownPaths, misses .positron/artifacts/
```

### Pre-Fix Behavior
- Spec/plan/tasks artifacts saved by OpenCode to `.positron/artifacts/` not found
- `saveArtifact` (fallback path) never called because speckit adapter status was not 'skipped'
- REVIEW phase: 0 spec/plan/tasks artifacts in DB → FAILED_BLOCKED

### Post-Fix Behavior
- Scanner finds `.positron/artifacts/specify.md` etc.
- artifact-only speckit runs return status 'skipped'
- `saveArtifact` called → DB populated
- REVIEW phase: 3/3 artifacts found → IMPLEMENT

### Existing Test Coverage
- `packages/speckit-adapter/src/__tests__/artifact-scanner.test.ts` — tests `scanWorkspace`
  but only with old paths (spec.md, .specify/spec.md). Does NOT test `.positron/artifacts/` paths.
- **Missing:** Test that `.positron/artifacts/specify.md` is detected as kind='spec'

### Repair
File: `packages/speckit-adapter/src/artifact-scanner.ts`
Change: Added `'.positron/artifacts/specify.md'`, `'.positron/artifacts/speckit.specify.md'`,
`'.positron/artifacts/plan.md'`, `'.positron/artifacts/speckit.plan.md'`,
`'.positron/artifacts/tasks.md'`, `'.positron/artifacts/speckit.tasks.md'` to known paths.

---

## Defect B: `saveArtifact` Not Called After Real-Mode OpenCode

### Observed Symptom
Artifacts existed on disk (`.positron/artifacts/specify.md` etc.) after real-mode OpenCode
execution, but the REVIEW phase reported `missing artifacts: spec, plan, tasks`.

### Exact Failing Phase
REVIEW (after SPECIFY → PLAN → TASKS → ANALYZE all ran successfully)

### Root Cause
In the server's `executePhase()`, the SPECIFY, PLAN, and TASKS phase handlers have this structure:
```typescript
if (realSpeckit) {
    // ... real spec kit + opencode execution ...
    result = transition(current, 'NEXT_PHASE', ...);
    break;  // ← exits switch without calling saveArtifact!
}
// Fallback: artifact-only detection → calls saveArtifact
```
When `POSITRON_ENABLE_REAL_SPECKIT=true`, the `break` after the real-mode code skips the
artifact-only fallback entirely. `saveArtifact` is only called in the fallback path.

### Affected Code Path
```
executePhase() case 'SPECIFY' / 'PLAN' / 'TASKS'
  → realSpeckit=true branch
    → opencode.runSlashCommand() — saves files to .positron/artifacts/
    → transition() → break
    // saveArtifact NEVER called here
  → fallback (only reached if realSpeckit=false)
    → speckit.runSpecify() — scans workspace
    → saveArtifact() — saves to DB
```

### Pre-Fix Behavior
DB artifacts table had only `research` kind (from WEB_RESEARCH phase).
spec/plan/tasks artifacts on disk but not in DB.
REVIEW queries DB → finds 0 spec/plan/tasks → FAILED_BLOCKED.

### Post-Fix Behavior
`saveArtifact(current.id, 'spec', specResult.summary)` called immediately after
real-mode OpenCode success, before the `break`. Same for plan and tasks.
DB has all 3 required artifact kinds → REVIEW passes.

### Existing Test Coverage
- `apps/server/src/__tests__/integration.test.ts` — full pipeline test but in fake mode.
  Fake mode uses FakeSpecKitAdapter which returns fake 'skipped' status, so saveArtifact
  is called via the fallback path. The real-mode path was never integration-tested.
- **Missing:** Test that in real-mode (or a mode where opencode produces artifacts),
  the artifacts are persisted to DB.

### Repair
File: `apps/server/src/index.ts`
Change: Added `saveArtifact(current.id, ...)` calls at lines 759, 814, 872
(before `break` in real-mode SPECIFY/PLAN/TASKS handlers).

---

## Defect C: Fix-Loop Runtime Environment Missing

### Observed Symptom
Run `4c9dcd45` (third attempt) reached FAILED_TRANSIENT at TEST phase but did NOT
execute the fix-loop retry. The run completed with 14 events and no fix-loop events.

### Exact Failing Phase
TEST → FAILED_TRANSIENT (no retry)

### Root Cause
The fix-loop is gated by `POSITRON_ENABLE_FIX_LOOP === 'true'` (line 1854 in server index.ts).
This environment variable was NOT set in the canary runtime environment. It was accidentally
omitted from `/tmp/positron-canary-env.sh`.

### Affected Code Path
```
runPipelineFull() → main loop
  → executePhase() → TEST → markFailed(FAILED_TRANSIENT)
  → fixLoopEnabled check → false → run ends without retry
```

### Pre-Fix Behavior
First TEST failure ends the run immediately. No retry attempts.

### Post-Fix Behavior
After adding `export POSITRON_ENABLE_FIX_LOOP=true` to `/tmp/positron-canary-env.sh`,
run `4c9dcd45` (fourth attempt) executed 3 fix-loop retries with exponential backoff
(1s, 2s, 4s). All 3 attempts reached TEST → FAILED_TRANSIENT (agent quality issue),
but the fix-loop infrastructure itself worked correctly.

### Existing Test Coverage
- `apps/server/src/__tests__/integration.test.ts` — test environment sets
  `POSITRON_ENABLE_FIX_LOOP` appropriately for fake-mode runs.
- **Missing:** No test verifying fix-loop activation in real-mode or when env var is unset.

### Repair
File: `/tmp/positron-canary-env.sh` (runtime config, not source)
Added `export POSITRON_ENABLE_FIX_LOOP=true`.

**Note:** The fix-loop env var is correctly documented in `.env.example` line 24
(`POSITRON_ENABLE_FIX_LOOP=false`). The defect was solely in the canary runtime
configuration, not in Positron source code. However, the documentation could be
improved to warn that the fix-loop is disabled by default.
