# Phase B — Runtime Hardening (P3.5) — Evidenz

Datum: 2026-08-20
Branch: `positron/issue-421-durable-control-plane`
Basis: Phase-A-Commit `0ef1991`

## Geschlossene P3-Lücken (§16)

1. **`Promise.race` beendete beim Timeout nicht den Worker-Prozess** → ersetzt durch `withCancellableTimeout` (AbortSignal-basierte Cancellation) in `packages/control-plane/src/cancellation.ts`; `runCommand` in `packages/sandbox/src/command-runner.ts` terminiert Child-Prozesse real (graceful SIGTERM → Grace → forced SIGKILL), optional Prozessgruppe (`killProcessGroup`).
2. **Crash mitten in RUNNING Attempt → stale Lease/hängender Claim** → durable Lease auf `cp_attempts` (V3: `lease_owner_id`, `lease_generation`, `lease_expires_at`, `claimed_at`), Heartbeat (`renewAttemptLease`), deterministische Stale-Lease-Recovery (`recoverStaleLeases` → STALE_LEASE, kein paralleler Re-Start), Fencing in `completeAttempt` (Owner + Generation müssen passen) und `assertAttemptActive` (stale Lease → Worker verliert Authority).

## Implementierte Primitiven

### Cancellation (`packages/control-plane/src/cancellation.ts`)
- `CancellationSource { signal, cancelled, cancel, onTerminate }` — Node-AbortSignal-basiert
- `withCancellableTimeout(promise, timeoutMs, cancellation)` — Timeout löst `cancel()` aus; Rückgabe `{ok:false, reason:'timeout'}` (konsistent mit P3-Aufruferstruktur); kein Wurf, keine unhandled rejection, late result wird verworfen
- `terminateChildProcess(child, {graceMs, killProcessGroup, exitTimeoutMs})` — SIGTERM → grace → SIGKILL; wartet auf Exit; nur owned Prozesse
- `startLeaseHeartbeat(cancellation, renew, ttlMs)` — Intervall = ttl/3

### Lease/Fencing (`packages/control-plane/src/schema.ts` V3, `store.ts`)
- `claimAttemptWithGeneration(db, id, {ownerId, leaseTtlMs})` → `{claimed, generation}` (Fencing-Token)
- `renewAttemptLease(db, id, ownerId, ttlMs)` — nur Owner darf erneuern
- `isAttemptLeaseValid(db, id, ownerId)` — Expiry-Check
- `recoverStaleLeases(db, {ownerId?, now?})` — running + abgelaufen → `failed/STALE_LEASE`; Owner-Grenzen respektiert
- `completeAttempt(db, id, update, {fencingOwnerId, fencingGeneration})` — Fencing vor Transition-Guard; stale/fremde Ergebnisse → REJECTED (null)

### Execution Context (`execution-context.ts`)
- `assertAttemptActive(db, attemptId, ownerId?)` — zusätzlich Lease-Validität; abgelaufene Lease → EXECUTION_CONTEXT_REQUIRED (Worker verliert Authority vor weiterer Mutation)

### Integration
- `durable-run.ts`: Build-/Verify-Pfade claimen mit Owner + Lease-TTL (`timeoutMs + 15s`), nutzen `withCancellableTimeout` mit eigener `CancellationSource`; alle finalen Completions mit Fencing (Owner + Generation)
- `research.ts` + `review.ts`: Claims mit Generation, Completions mit Fencing; Research-Timeout nutzt `withCancellableTimeout`
- `command-runner.ts`: Timeout/AbortSignal → reale Prozess-Termination (SIGTERM→SIGKILL, optional Gruppe); `terminated`-Flag im Result; kein late Result nach Abbruch

## Canaries (real, keine Mocks)

### `runtime-hardening-canaries.test.ts` (11 Tests, Control Plane)
- **ACTIVE_CANCELLATION**: Timeout löst Cancellation aus (Terminator beobachtet), Attempt → `timed_out`, Late Result → verworfen (Status bleibt `timed_out`, output_json null)
- **CANCELLATION_IDEMPOTENT**: 3× cancel → 1 Terminator-Call
- **CHILD_PROCESS_SIGTERM**: `sleep 30` real gespawnt, per Termination beendet, Zombie-Check (kill(pid,0) → ESRCH)
- **CHILD_PROCESS_SIGKILL_ESCALATION**: Node-Prozess mit SIGTERM-Handler ignoriert SIGTERM → nach Grace (300ms) SIGKILL; Zombie-Check; Grace nachweislich abgewartet
- **LEASE_CLAIM**: Owner/Generation/Expiry gesetzt; zweiter paralleler Claim → false
- **LEASE_RENEW**: fremder Owner kann nicht erneuern; Owner verlängert Expiry
- **STALE_LEASE + RECOVERY**: abgelaufene Lease → failed/STALE_LEASE; alter Owner kann nicht mehr finalisieren; neuer Attempt mit frischer Generation startet; fremde Generation kann neuen Attempt nie anfassen
- **FENCING CANARY (§24)**: A (Gen 1) lease abgelaufen → Recovery → B (Gen 2) übernimmt → A liefert late → REJECTED (STALE_LEASE, output null); B bleibt Authority und finalisiert; DUPLICATE_EFFECT_ZERO (nur B schrieb)
- **STALE_RESULT_REJECTED**: falsche Generation/Owner → rejected; korrektes Token → erlaubt
- **CRASH_MID_BUILD_RECOVERY**: Claim → Controller-"Crash" (kein Heartbeat) → stale → deterministic failed/STALE_LEASE; kein paralleler Claim des kontaminierten Attempts; Owner-Grenzen respektiert

### `command-runner-cancellation.test.ts` (4 Tests, Sandbox)
- Timeout beendet `sleep 60` real (<5s statt 60s)
- AbortSignal bricht aktiv ab (Reject /cancelled/)
- `killProcessGroup` beendet Prozessbaum (bash + Kind)
- Normalpfad unverändert (stdout/exitCode/terminated=false)

## Gate-Status Phase B

```text
ACTIVE_CANCELLATION=PASS
CHILD_PROCESS_CANCELLATION=PASS
TIMEOUT_FINALIZATION=PASS
NO_POST_TIMEOUT_MUTATION=PASS
LEASE_OWNERSHIP=PASS
LEASE_HEARTBEAT=PASS
STALE_LEASE_DETECTION=PASS
STALE_LEASE_RECOVERY=PASS
FENCING=PASS
LATE_STALE_RESULT_REJECTED=PASS
NO_ZOMBIE_WORKER=PASS
CRASH_MID_BUILD_RECOVERY=PASS
DUPLICATE_EFFECT_ZERO=PASS
```

Regression: `npx vitest run packages apps/server apps/worker` → **2395/2395 grün (109 Files)**; `npm run build` → 0 Fehler; `npm run typecheck` → 0 Fehler.
