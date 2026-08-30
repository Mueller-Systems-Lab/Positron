# Issue #447 — Source Retirement Readiness

Retirement readiness is not repository archival. This run performs no archive,
delete, transfer, branch deletion, release change or history rewrite.

## Gate matrix

| Source | Assets inventoried | Assets migrated/rejected | Rationale recorded | Secrets copied | Positron gates | Retirement ready | Next bounded action |
|---|---:|---:|---:|---:|---:|---:|---|
| klarstart | PARTIAL — source unresolved | YES — unknown explicitly held | YES | NO | PASS | NO | Owner supplies canonical source ref/archive |
| klarstart_001 | PARTIAL — source unresolved | YES — unknown explicitly held | YES | NO | PASS | NO | Owner supplies canonical source ref/archive |
| klarstart_002 | PARTIAL — source unresolved | YES — unknown explicitly held | YES | NO | PASS | NO | Owner supplies canonical source ref/archive |
| _klarstart_ | PARTIAL — source unresolved | YES — unknown explicitly held | YES | NO | PASS | NO | Owner supplies canonical source ref/archive |
| Morpheus_workflow | YES | YES | YES | NO | PASS | NO | Publish source pointer after owner retirement decision |
| ghiw-system-of-record | YES | YES | YES | NO | PASS | NO | Publish source pointer after owner retirement decision |
| n8n-blueprint-workflow lineage | YES — snapshots | YES | YES | NO | PASS | NO | Resolve canonical source identity and pointer |
| ai_coding_orchestrator | YES | YES | YES | NO | PASS | NO | Owner decides whether public source remains historical |
| universal-ai-test-harness | YES | YES | YES | NO | PASS | NO | Publish pointer after native capability release |
| llm_benschmark | YES | YES | YES | NO | PASS | NO | Keep benchmark source separate until corpus licensing/ownership review |
| agentic-browser-repair-kit | NO — source unresolved | NO — validation required | YES | NO | PASS | NO | Supply source checkout and inspect fixtures |
| mission-driven-agent-loop | NO — source unresolved | YES — concepts reimplemented | YES | NO | PASS | NO | Supply source checkout for final asset audit |
| OpenCode_GitHub_Issue_Worker | YES | YES | YES | NO | PASS | NO | Keep historical worker until companion/native boundary is accepted |
| OpenCode-Hermes-Agent-Bootstrap | YES | YES — separate | YES | NO | PASS | NO | Keep as OCAE distribution companion |
| Positron-Auto-Growth-System | NO — source unresolved | NO — validation required | YES | NO | PASS | NO | Supply source identity; product semantics remain out of scope |
| positron-e2e-test | NO — source unresolved | NO — validation required | YES | NO | PASS | NO | Supply source checkout and migrate only deterministic fixtures |
| positron-external-test | NO — source unresolved | NO — validation required | YES | NO | PASS | NO | Supply source checkout and migrate only deterministic fixtures |
| positron-sandbox | PARTIAL — target references only | YES — no code imported | YES | NO | PASS | NO | Keep protected canary separate; no controller retirement claim |
| zero-human-company-control-plane | PARTIAL — generic concepts only | YES — generic patterns reimplemented | YES | NO | PASS | NO | Owner supplies canonical source if further audit is desired |
| Neutrino | YES | YES | YES | NO | PASS | NO | Owner decides whether source remains independent safety library |

`PASS` means the merged Positron gates are green. All rows are `NO` because
retirement requires a later explicit owner decision and, for public sources, a
pointer update that is outside this read-only consolidation run. For unresolved
sources, the PASS applies only to Positron's current gates, not to missing
source evidence.

## Bounded retirement plan

1. Owner reviews this matrix and supplies canonical refs for unresolved sources.
2. A separate source-by-source plan verifies licenses, public pointers and
   final evidence retention.
3. Only after explicit authorization may a source receive a non-destructive
   pointer update or be considered for archival.
4. Positron main/PR gates and source evidence remain independently verifiable.
