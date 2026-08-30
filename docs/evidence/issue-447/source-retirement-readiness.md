# Issue #447 — Source Retirement Readiness

Retirement readiness is not repository archival. This run performs no archive,
delete, transfer, branch deletion, release change or history rewrite.

## Gate matrix

| Source | Assets inventoried | Assets migrated/rejected | Rationale recorded | Secrets copied | Positron gates | Retirement ready | Next bounded action |
|---|---:|---:|---:|---:|---:|---:|---|
| klarstart | PARTIAL — source unresolved | YES — unknown explicitly held | YES | NO | PENDING | NO | Owner supplies canonical source ref/archive |
| klarstart_001 | PARTIAL — source unresolved | YES — unknown explicitly held | YES | NO | PENDING | NO | Owner supplies canonical source ref/archive |
| klarstart_002 | PARTIAL — source unresolved | YES — unknown explicitly held | YES | NO | PENDING | NO | Owner supplies canonical source ref/archive |
| _klarstart_ | PARTIAL — source unresolved | YES — unknown explicitly held | YES | NO | PENDING | NO | Owner supplies canonical source ref/archive |
| Morpheus_workflow | YES | YES | YES | NO | PENDING | NO | Publish source pointer after owner retirement decision |
| ghiw-system-of-record | YES | YES | YES | NO | PENDING | NO | Publish source pointer after owner retirement decision |
| n8n-blueprint-workflow lineage | YES — snapshots | YES | YES | NO | PENDING | NO | Resolve canonical source identity and pointer |
| ai_coding_orchestrator | YES | YES | YES | NO | PENDING | NO | Owner decides whether public source remains historical |
| universal-ai-test-harness | YES | YES | YES | NO | PENDING | NO | Publish pointer after native capability release |
| llm_benschmark | YES | YES | YES | NO | PENDING | NO | Keep benchmark source separate until corpus licensing/ownership review |
| agentic-browser-repair-kit | NO — source unresolved | NO — validation required | YES | NO | PENDING | NO | Supply source checkout and inspect fixtures |
| mission-driven-agent-loop | NO — source unresolved | YES — concepts reimplemented | YES | NO | PENDING | NO | Supply source checkout for final asset audit |
| OpenCode_GitHub_Issue_Worker | YES | YES | YES | NO | PENDING | NO | Keep historical worker until companion/native boundary is accepted |
| OpenCode-Hermes-Agent-Bootstrap | YES | YES — separate | YES | NO | PENDING | NO | Keep as OCAE distribution companion |
| Positron-Auto-Growth-System | NO — source unresolved | NO — validation required | YES | NO | PENDING | NO | Supply source identity; product semantics remain out of scope |
| positron-e2e-test | NO — source unresolved | NO — validation required | YES | NO | PENDING | NO | Supply source checkout and migrate only deterministic fixtures |
| positron-external-test | NO — source unresolved | NO — validation required | YES | NO | PENDING | NO | Supply source checkout and migrate only deterministic fixtures |
| positron-sandbox | PARTIAL — target references only | YES — no code imported | YES | NO | PENDING | NO | Keep protected canary separate; no controller retirement claim |
| zero-human-company-control-plane | PARTIAL — generic concepts only | YES — generic patterns reimplemented | YES | NO | PENDING | NO | Owner supplies canonical source if further audit is desired |
| Neutrino | YES | YES | YES | NO | PENDING | NO | Owner decides whether source remains independent safety library |

`PENDING` means the final Positron PR gates are not claimed until local and
required CI checks run on the frozen final head. All rows are `NO` because
retirement requires a later explicit owner decision and, for public sources, a
pointer update that is outside this read-only consolidation run.

## Bounded retirement plan

1. Owner reviews this matrix and supplies canonical refs for unresolved sources.
2. A separate source-by-source plan verifies licenses, public pointers and
   final evidence retention.
3. Only after explicit authorization may a source receive a non-destructive
   pointer update or be considered for archival.
4. Positron main/PR gates and source evidence remain independently verifiable.
