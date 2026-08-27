---
title: Positron API Overview
date: 2026-06-27
author: Positron Team
---

# Positron — API Overview

> **Note:** This document catalogs the current API endpoints as of the latest sync. Full expansion of Issue #229 and #243 endpoints is tracked separately in [Issue #251](https://github.com/Mueller-Systems-Lab/Positron/issues/251).

All routes are served by the Express server under `/api`. The current implementation does not enforce application-level authentication; access is expected to be protected by deployment controls.

## Common response notes

- Validation failures return `400` with `{ error: 'VALIDATION_ERROR', message: string }` for the affected endpoints.
- Missing resources return `404` with `{ error: 'Not found' }` or a similar message.
- State conflicts on run control return `409`.
- Adapter/streaming failures may surface as `500` or as a JSON error payload from the Express error handler.

## POST `/api/repos`

- **Method:** `POST`
- **Path:** `/api/repos`
- **Description:** Register a repository for orchestration.
- **Request body:**

```json
{ "owner": "octo-org", "name": "repo-name" }
```

- **Response:**

```json
{ "id": "repo-1", "status": "registered", "mode": "fake" }
```

- **Error codes:** `400` validation error.

## GET `/api/repos/:id/issues`

- **Method:** `GET`
- **Path:** `/api/repos/:id/issues`
- **Description:** List open issues for the configured repository.
- **Request body:** none.
- **Response:**

```json
{ "issues": [] }
```

- **Notes:** `:id` is currently a route placeholder; the handler reads the repository from runtime configuration.
- **Error codes:** `500` adapter/runtime error.

## POST `/api/repos/:repoId/runs`

- **Method:** `POST`
- **Path:** `/api/repos/:repoId/runs`
- **Description:** Start a new run for the given issue number.
- **Request body:**

```json
{ "issueNumber": 42, "autonomyLevel": 2 }
```

- **Response:**

```json
{
  "run": {},
  "events": [],
  "eventCount": 0
}
```

- **Error codes:** `400` validation error.

## GET `/api/runs`

- **Method:** `GET`
- **Path:** `/api/runs`
- **Description:** List all persisted runs.
- **Request body:** none.
- **Response:**

```json
{ "runs": [] }
```

- **Error codes:** none expected beyond server failure.

## GET `/api/runs/:id`

- **Method:** `GET`
- **Path:** `/api/runs/:id`
- **Description:** Get a single run and its events.
- **Request body:** none.
- **Response:**

```json
{ "run": {}, "events": [] }
```

- **Error codes:** `404` when the run does not exist.

## GET `/api/runs/:id/events/stream`

- **Method:** `GET`
- **Path:** `/api/runs/:id/events/stream`
- **Description:** Server-Sent Events stream for live run updates.
- **Request body:** none.
- **Response:** `text/event-stream` with:
  - `initial` event containing `{ run, events }`
  - `run-event` events for newly persisted run events
  - keepalive comments every 15 seconds
- **Error codes:** `404` if the run is missing.

## GET `/api/health`

- **Method:** `GET`
- **Path:** `/api/health`
- **Description:** Basic server health check.
- **Request body:** none.
- **Response:**

```json
{ "status": "ok", "runs": 0 }
```

- **Error codes:** none expected beyond server failure.

## GET `/api/adapters/health`

- **Method:** `GET`
- **Path:** `/api/adapters/health`
- **Description:** Report adapter availability and mode.
- **Request body:** none.
- **Response:**

```json
{
  "github": { "available": true, "mode": "fake" },
  "specKit": {},
  "openCode": {}
}
```

- **Error codes:** returns `{ "error": "..." }` on internal adapter-check failures.

## POST `/api/demo/blueprint`

- **Method:** `POST`
- **Path:** `/api/demo/blueprint`
- **Description:** Start a demo run from a blueprint markdown string.
- **Request body:**

```json
{ "blueprint": "# Blueprint", "issueNumber": 56 }
```

- **Response:**

```json
{ "run": {}, "message": "Blueprint run started", "blueprint": "# Blueprint" }
```

- **Error codes:** `400` if `blueprint` is missing or `issueNumber` is invalid.

## GET `/api/demo/blueprint/:runId`

- **Method:** `GET`
- **Path:** `/api/demo/blueprint/:runId`
- **Description:** Retrieve the stored blueprint payload for a demo run.
- **Request body:** none.
- **Response:**

```json
{ "blueprint": "# Blueprint", "runId": "..." }
```

- **Error codes:** `404` if no blueprint event exists for the run.

## GET `/api/safety`

- **Method:** `GET`
- **Path:** `/api/safety`
- **Description:** Show current safety-gate switches.
- **Request body:** none.
- **Response:**

```json
{
  "enableMerge": false,
  "mergeDryRun": true,
  "enablePush": false,
  "killSwitch": true,
  "enableFixLoop": false
}
```

- **Error codes:** none expected beyond server failure.

## GET `/api/runs/:id/merge-status`

- **Method:** `GET`
- **Path:** `/api/runs/:id/merge-status`
- **Description:** Return merge readiness and blocking reasons.
- **Request body:** none.
- **Response:**

```json
{
  "enabled": false,
  "killSwitch": true,
  "dryRun": true,
  "runStatus": "active",
  "hasTestEvidence": true,
  "branch": "positron/issue-42-demo",
  "canMerge": false,
  "blockedReasons": ["Kill-Switch active"]
}
```

- **Error codes:** `404` if the run does not exist.

## POST `/api/runs/:id/control`

- **Method:** `POST`
- **Path:** `/api/runs/:id/control`
- **Description:** Pause, abort, resume, or retry a run.
- **Request body:**

```json
{ "action": "pause" }
```

- **Valid actions:** `pause`, `abort`, `resume`, `retry`
- **Response:**

```json
{ "ok": true, "action": "pause", "runId": "..." }
```

- **Error codes:** `400` invalid action, `404` run not found, `409` invalid state transition.

## Issue #229 Endpoints — Architectural Specification

> **Status:** Designed in [Issue #229](https://github.com/Mueller-Systems-Lab/Positron/issues/229). These endpoints are part of the Tool Gateway + Oversight UI + Blueprint Launcher + Infrastructure layer. POST endpoints are **disabled by default** (gateway safety gate). Notation: `[planned]` = designed but not fully wired; `[active]` = implemented and active.

### Oversight Endpoints (Issue #229)

HL7: `/api/oversight`

#### GET `/api/oversight/questions`

- **Method:** `GET`
- **Path:** `/api/oversight/questions`
- **Status:** `[planned]`
- **Description:** List pending oversight questions awaiting human review.
- **Response:**
```json
{
  "questions": [
    {
      "id": "q-1",
      "runId": "...",
      "question": "Approve tool execution?",
      "tool": "repo.write_file",
      "phase": "IMPLEMENT",
      "createdAt": "2026-..."
    }
  ]
}
```

#### POST `/api/oversight/answer`

- **Method:** `POST`
- **Path:** `/api/oversight/answer`
- **Status:** `[planned]` — disabled by default
- **Description:** Answer a pending oversight question (approve/deny).
- **Request body:**
```json
{ "questionId": "q-1", "answer": "approve", "reason": "Reviewed and approved" }
```
- **Response:**
```json
{ "ok": true, "questionId": "q-1", "answer": "approve" }
```
- **Error codes:** `400` invalid answer, `404` question not found, `409` already answered.

#### POST `/api/oversight/pause`

- **Method:** `POST`
- **Path:** `/api/oversight/pause`
- **Status:** `[planned]` — disabled by default
- **Description:** Pause the active pipeline run for human review.
- **Request body:**
```json
{ "runId": "...", "reason": "Need to review output" }
```
- **Response:**
```json
{ "ok": true, "runId": "...", "action": "pause" }
```
- **Error codes:** `404` run not found, `409` invalid state transition.

#### POST `/api/oversight/abort`

- **Method:** `POST`
- **Path:** `/api/oversight/abort`
- **Status:** `[planned]` — disabled by default
- **Description:** Abort the active pipeline run immediately.
- **Request body:**
```json
{ "runId": "...", "reason": "Unsafe operation detected" }
```
- **Response:**
```json
{ "ok": true, "runId": "...", "action": "abort" }
```
- **Error codes:** `404` run not found, `409` invalid state transition.

#### POST `/api/oversight/attention`

- **Method:** `POST`
- **Path:** `/api/oversight/attention`
- **Status:** `[planned]` — disabled by default
- **Description:** Request human attention for a specific run event.
- **Request body:**
```json
{ "runId": "...", "message": "Unusual diff detected", "severity": "warning" }
```
- **Response:**
```json
{ "ok": true, "attentionId": "att-1", "acknowledged": false }
```
- **Error codes:** `400` invalid severity, `404` run not found.

#### GET `/api/oversight/status`

- **Method:** `GET`
- **Path:** `/api/oversight/status`
- **Status:** `[planned]`
- **Description:** Current oversight system status (pending questions, active attention requests).
- **Response:**
```json
{
  "pendingQuestions": 2,
  "activeAttentionRequests": 1,
  "pausedRuns": 0,
  "overallStatus": "needs_attention"
}
```

### Blueprint Endpoints (Issue #229)

HL7: `/api/blueprints`

#### POST `/api/blueprints/validate`

- **Method:** `POST`
- **Path:** `/api/blueprints/validate`
- **Status:** `[planned]` — disabled by default
- **Description:** Validate a blueprint markdown structure without executing it.
- **Request body:**
```json
{ "blueprint": "# Blueprint\n## Phase A\n..." }
```
- **Response:**
```json
{ "valid": true, "warnings": [], "phaseCount": 3, "issues": [] }
```
- **Error codes:** `400` invalid blueprint format.

#### POST `/api/blueprints/import`

- **Method:** `POST`
- **Path:** `/api/blueprints/import`
- **Status:** `[planned]` — disabled by default
- **Description:** Import a blueprint from an external source (issue, file, URL).
- **Request body:**
```json
{ "source": "issue", "issueUrl": "https://github.com/owner/repo/issues/42" }
```
- **Response:**
```json
{ "blueprint": "# Blueprint...", "source": "issue", "imported": true }
```
- **Error codes:** `400` invalid source, `500` import failure.

#### GET `/api/blueprints/:id`

- **Method:** `GET`
- **Path:** `/api/blueprints/:id`
- **Status:** `[planned]`
- **Description:** Get a stored blueprint by ID.
- **Response:**
```json
{ "id": "bp-1", "blueprint": "# Blueprint...", "createdAt": "2026-...", "source": "issue" }
```
- **Error codes:** `404` blueprint not found.

#### POST `/api/blueprints/create-run-plan`

- **Method:** `POST`
- **Path:** `/api/blueprints/create-run-plan`
- **Status:** `[planned]` — disabled by default
- **Description:** Generate a run plan (phases, steps, tools) from a validated blueprint.
- **Request body:**
```json
{ "blueprintId": "bp-1", "autonomyLevel": 2 }
```
- **Response:**
```json
{ "runPlan": { "phases": [...], "estimatedTools": 12, "estimatedDurationMs": 30000 } }
```
- **Error codes:** `400` invalid autonomy level, `404` blueprint not found.

#### POST `/api/blueprints/start-run`

- **Method:** `POST`
- **Path:** `/api/blueprints/start-run`
- **Status:** `[planned]` — disabled by default
- **Description:** Start a pipeline run from a validated blueprint run plan.
- **Request body:**
```json
{ "runPlanId": "rp-1", "mode": "dry-run" }
```
- **Response:**
```json
{ "run": { "id": "...", "phase": "QUEUED", "status": "active" } }
```
- **Error codes:** `400` invalid mode, `404` run plan not found.

#### POST `/api/blueprints/handoff`

- **Method:** `POST`
- **Path:** `/api/blueprints/handoff`
- **Status:** `[planned]` — disabled by default
- **Description:** Handoff a completed blueprint run to the next pipeline stage.
- **Request body:**
```json
{ "runId": "...", "target": "merge", "artifacts": ["test-report", "diff-summary"] }
```
- **Response:**
```json
{ "ok": true, "runId": "...", "handoff": "merge", "evidenceEventId": "evt-1" }
```
- **Error codes:** `400` invalid target, `404` run not found, `409` run not in handoff-ready state.

### Infrastructure State Endpoints (Issue #229)

HL7: `/api/infrastructure`

#### GET `/api/infrastructure/status`

- **Method:** `GET`
- **Path:** `/api/infrastructure/status`
- **Status:** `[planned]`
- **Description:** Overall infrastructure health and component status.
- **Response:**
```json
{
  "status": "healthy",
  "components": {
    "database": "connected",
    "toolGateway": "disabled",
    "mcpServers": 0,
    "openCodeProvider": "not_detected"
  }
}
```

#### GET `/api/infrastructure/provider-detection`

- **Method:** `GET`
- **Path:** `/api/infrastructure/provider-detection`
- **Status:** `[planned]`
- **Description:** Detect available AI coding providers (Ollama, LM Studio, OpenCode, cloud).
- **Response:**
```json
{
  "detected": ["ollama", "lmstudio"],
  "ollama": { "available": true, "models": ["codellama:7b"], "endpoint": "http://localhost:11434" },
  "lmstudio": { "available": true, "models": [], "endpoint": "http://localhost:1234" },
  "openCode": { "detected": false },
  "cloud": { "available": false }
}
```

#### GET `/api/infrastructure/model-profile`

- **Method:** `GET`
- **Path:** `/api/infrastructure/model-profile`
- **Status:** `[planned]`
- **Description:** Active model profile including capabilities, token limits, and warm-up status.
- **Response:**
```json
{
  "provider": "ollama",
  "model": "codellama:7b",
  "capabilities": { "codeGeneration": true, "reasoning": "limited", "toolUse": false },
  "tokenLimit": 4096,
  "warmUpStatus": "cold",
  "lastWarmUp": null
}
```

#### POST `/api/infrastructure/speckit-sync`

- **Method:** `POST`
- **Path:** `/api/infrastructure/speckit-sync`
- **Status:** `[planned]` — disabled by default
- **Description:** Synchronize Spec Kit configuration with the active OpenCode model profile.
- **Request body:**
```json
{ "modelProfile": "codellama:7b", "syncTargets": ["specs", "tests", "constraints"] }
```
- **Response:**
```json
{ "ok": true, "syncedTargets": ["specs", "tests"], "warnings": [] }
```
- **Error codes:** `400` invalid targets, `500` sync failure.

#### POST `/api/infrastructure/mcp-warmup`

- **Method:** `POST`
- **Path:** `/api/infrastructure/mcp-warmup`
- **Status:** `[planned]` — disabled by default
- **Description:** Trigger MCP server warm-up to pre-load tools and verify connectivity.
- **Request body:**
```json
{ "servers": ["github", "brave-search"], "timeoutMs": 30000 }
```
- **Response:**
```json
{
  "warmedUp": ["github"],
  "failed": [],
  "skipped": ["brave-search"],
  "warmUpDurationMs": 5200
}
```
- **Error codes:** `400` no servers specified, `500` warm-up failure.

### Infrastructure Gates (Issue #229)

HL7: `/api/infrastructure/gates`

#### GET `/api/infrastructure/gates/status`

- **Method:** `GET`
- **Path:** `/api/infrastructure/gates/status`
- **Status:** `[active]` — served via `GET /api/safety`
- **Description:** Current state of all infrastructure-level safety gates (merge, push, kill-switch, fix-loop).
- **Response:**
```json
{
  "enableMerge": false,
  "mergeDryRun": true,
  "enablePush": false,
  "killSwitch": true,
  "enableFixLoop": false,
  "gateCount": 5,
  "activeBlocks": ["killSwitch", "enableMerge"]
}
```
- **Note:** This endpoint mirrors the existing `GET /api/safety` and `GET /api/runs/:id/merge-status` responses at the infrastructure level.

### Tool Gateway Endpoints (Issue #229)

HL7: `/api/tool-gateway`

> **Note:** The Tool Gateway defaults to **disabled** (`enabled: false`). All POST/write operations require explicit enablement and autonomy level validation.

#### GET `/api/tool-gateway/status`

- **Method:** `GET`
- **Path:** `/api/tool-gateway/status`
- **Status:** `[planned]`
- **Description:** Tool Gateway health including MCP server connectivity and provider status.
- **Response:**
```json
{
  "enabled": false,
  "registrySize": 8,
  "mcpServers": {
    "connected": 0,
    "configured": [],
    "providerStatus": "no_provider"
  },
  "gates": {
    "pathBoundary": true,
    "egress": true,
    "secretRedaction": true
  },
  "auditSink": "active"
}
```

#### GET `/api/tool-gateway/tools`

- **Method:** `GET`
- **Path:** `/api/tool-gateway/tools`
- **Status:** `[planned]`
- **Description:** List all registered tools with category, MCP server origin, and warm-up status.
- **Response:**
```json
{
  "tools": [
    {
      "id": "repo.read_file",
      "title": "Read File",
      "category": "repo",
      "mcpServerName": null,
      "riskLevel": "read",
      "warmupStatus": "not_applicable",
      "allowedPhases": ["SCAN", "ANALYZE", "IMPLEMENT", "TEST"]
    },
    {
      "id": "github.comment_evidence_draft",
      "title": "Comment Evidence Draft",
      "category": "github",
      "mcpServerName": "github",
      "riskLevel": "write",
      "warmupStatus": "cold",
      "allowedPhases": ["EVIDENCE"]
    }
  ],
  "totalTools": 8,
  "activeTools": 0,
  "disabledReason": "gateway_disabled"
}
```

---

## Changelog

- **2026-07-02:** Added Issue #229 endpoint specifications (Oversight, Blueprints, Infrastructure State, Infrastructure Gates, Tool Gateway). Total 18 planned + 2 tool-gateway endpoints. POST endpoints marked disabled-by-default. [Issue #251](https://github.com/Mueller-Systems-Lab/Positron/issues/251)
- **2026-06-27:** Initial sync of current endpoints.
