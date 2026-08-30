# Issue #464 — Source validation report

## Search boundary and result

Read-only search was performed on 2026-08-31 against: connected GitHub
installation repository search; `Mueller-Systems-Lab` repository search;
historical `xxammaxx` repository listing/search; local Git remotes; local
repository clones/worktrees under `/media/xxammaxx/projekte`; and committed
Issue #447/455 evidence and historical references. No source repository was
modified. No credentials or secrets were copied.

Two requested names resolve to inspectable evidence: the n8n repository exists
as a local historical snapshot whose remote currently returns 404, and the
historical sandbox name maps only to the current private organization canary.
The other ten names remain externally unresolvable after these searches.

## Complete evidence rows

| SOURCE | CANONICAL_IDENTITY | DEFAULT_BRANCH | HEAD_SHA | LAST_MEANINGFUL_ACTIVITY | LANGUAGES | BUILD_SYSTEM | RUNTIME_ROLE | UNIQUE_SOURCE_CODE | UNIQUE_TESTS | UNIQUE_FIXTURES | UNIQUE_SCHEMAS | UNIQUE_ADRS | UNIQUE_THREAT_MODELS | UNIQUE_DEPLOYMENT_RECIPES | UNIQUE_RECOVERY_EVIDENCE | UNIQUE_BENCHMARK_DATA | SECURITY_FINDINGS | SECRET_COPY_REQUIRED | DUPLICATED_BY_POSITRON | PARTIALLY_SUPERSEDED | FULLY_SUPERSEDED | FINAL_DISPOSITION | MIGRATION_REQUIRED | RETIREMENT_READY | RATIONALE | EVIDENCE_REFS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| klarstart | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | UNKNOWN legacy source | UNKNOWN; contents unavailable | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REFERENCE | NO | NO | No identity or content evidence; do not infer obsolete | #447 inventory; search boundary above |
| klarstart_001 | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | UNKNOWN legacy variant | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REFERENCE | NO | NO | Same as klarstart | #447 inventory; search boundary above |
| klarstart_002 | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | UNKNOWN legacy variant | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REFERENCE | NO | NO | Same as klarstart | #447 inventory; search boundary above |
| _klarstart_ | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | UNKNOWN legacy variant | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REFERENCE | NO | NO | Same as klarstart | #447 inventory; search boundary above |
| n8n-blueprint-workflow | `xxammaxx/n8n-blueprint-workflow` (local historical snapshot; remote 404) | main | `91d9de6becd3bb87ca7e0fc689333dd2567f6ba8` | 2026-07-25 | Python, JSON, Markdown | `.env.example`; operational docs; no package manifest observed | n8n/provisioning and workflow integrity evidence | Provisioning wrappers and fail-closed workflow patterns are present in snapshot | Evidence-linked operational validation; no unverified test import | Workflow JSON/evidence snapshots | Provisioning contracts and node classification docs | ADR-006 and related ADRs | Security classification and secret-hygiene evidence | Docker/Proxmox runbooks | Rollback, recovery and authenticated dry-hop evidence | None identified | Snapshot contains secret-hygiene controls; no secrets copied | NO | PARTIAL | YES | NO | ADAPT | NO | NO | Valuable evidence is already represented in Positron docs/policy; controller remains Positron-owned | local remote; `/media/xxammaxx/projekte/N8N/n8n-blueprint-provisioning-runtime-*`; #447 inventory |
| agentic-browser-repair-kit | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | Browser repair workload | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REFERENCE | NO | NO | Preserve unknown status; no browser authority imported | #447 inventory; search boundary above |
| mission-driven-agent-loop | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | Mission-loop concept | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REIMPLEMENT | NO | NO | Durable Positron attempts already express the known concept; source-specific assets remain unknown | #447 inventory; search boundary above |
| Positron-Auto-Growth-System | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | Growth/product concept | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REFERENCE | NO | NO | Product semantics are outside this controller consolidation | #447 inventory; search boundary above |
| positron-e2e-test | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | External E2E workload | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REFERENCE | NO | NO | Do not copy unverified tests or fixtures | #447 inventory; search boundary above |
| positron-external-test | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | External integration workload | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REFERENCE | NO | NO | Existing adapter/integration surfaces remain authoritative | #447 inventory; search boundary above |
| positron-sandbox | `Mueller-Systems-Lab/positron-308-sandbox` (private canary alias; historical `xxammaxx/positron-sandbox` unavailable) | main | `381f34a32b98bfa510ebecdd28ece9ae00c6fd31` | 2026-08-28 | Markdown | none; README only | Disposable supervised Issue #308 canary | None beyond README marker | None | None | None | None | None | None | None | None | Private disposable repo; no production data stated | NO | YES | NO | YES | KEEP_SEPARATE | NO | NO | This is a canary target, not controller source; no retirement or mutation performed | GitHub repo metadata/commit; #447/#308 evidence |
| zero-human-company-control-plane | NOT_FOUND_AFTER_EXHAUSTIVE_SEARCH | — | — | — | UNKNOWN | UNKNOWN | Generic governance concept | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | No source content available to scan | NO | NO | NO | NO | REIMPLEMENT | NO | NO | Generic patterns already live behind Positron authority; no Paperclip-named source inspected | #447 inventory; search boundary above |

## Acceptance mapping

- `SOURCE_REPOS_TOTAL=12`; `SOURCE_REPOS_RESOLVED=2`; `SOURCE_REPOS_UNRESOLVED=10`.
- `EXTERNALLY_UNRESOLVABLE_COUNT=10`; `EXHAUSTIVE_SEARCH_EVIDENCE=PASS` for the
  bounded accessible surfaces listed above.
- `COMPLETE_EVIDENCE_ROW=YES` for all 12 rows; unknown fields are explicitly
  marked unknown and are not treated as obsolete.
- `MIGRATED_OR_EXPLICITLY_REJECTED_WITH_RATIONALE=YES`: no newly discovered
  unique runtime asset required migration; existing n8n evidence is adapted or
  referenced, and the canary remains separate.
- `SOURCE_REPOSITORY_MUTATIONS=0`, `SECRETS_COPIED=0`,
  `NEW_CONTROL_PLANE_COUNT=0`, `DEEPSEEK_AGENT_USAGE=0`, `PAID_MODEL_CALLS=0`.
- `SOURCE_REPOS_RETIREMENT_READY=0`: retirement remains owner-authorized and
  is intentionally separate from evidence evaluation.

This report does not close #447: ten names remain externally unresolvable, so
the portfolio contract cannot truthfully claim that all source identities and
contents were evaluated.
