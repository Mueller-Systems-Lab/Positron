# Positron Capability Baseline v1.0.0

> **Status:** ACTIVE
> **Established:** 2026-08-03T06:34:31Z
> **Evidence Run:** POS-NORTHSTAR-R4
> **Controller Issue:** Mueller-Systems-Lab/Positron#308

## Quick Reference

| What | Value |
|------|-------|
| Positron SHA | 4e7093b9062b46be00c030c362ce99fd41a02420 |
| Sandbox SHA | 09700b0e1c920a005ec5971f15172e544c516e30 |
| Merkle Root | 5487a119d3d8a14c140455128f9741119e8a0569574420e4de7701085b57234f |
| Validated Capabilities | 21 (SUPERVISED_VALIDATED) |
| Test-Validated Only | 6 |
| Not Yet Validated | 13 |
| Out of Scope | 4 |

## Validated Capabilities

Positron has demonstrated the following capabilities through real, supervised execution:

1. Issue-Ingestion, Repository-Reconciliation
2. Specification, Planning, Task Creation
3. RED-before-GREEN development cycle
4. Minimal implementation with full tests
5. Seeded-Fault validation
6. Independent verification (fresh clone)
7. Branch creation, Commit, Push
8. Draft PR creation
9. Repeatability (independent second canary)
10. Actor and Tool provenance tracking
11. Human-Gate-controlled merge (SHA-bound)
12. Post-merge verification and issue closure
13. Controller-to-GitHub state reconciliation

## Safety Boundaries

- **All merges require SHA-bound Human Gate approval**
- **All operations limited to sandbox repository**
- **No auto-merge, no direct main push, no branch deletion**
- **No unsupervised operation**
- **No productive external repositories**

## Next Capability Target

**POS-NORTHSTAR-R5 — Failure Recovery, Restart Resume & No-Duplicate-Mutation Canary**

## Full Evidence

See `docs/evidence/positron-north-star/POS-NORTHSTAR-R4/` for the complete freeze package.
