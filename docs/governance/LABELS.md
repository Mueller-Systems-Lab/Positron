# Label Convention — Positron Governance

> **Version:** 1.0.0 | **Effective:** 2026-06-27 | **Scope:** Mueller-Systems-Lab/Positron GitHub labels

---

## Principles

1. **Additive, not destructive.** New labels are added; existing labels are not deleted without owner decision.
2. **No bulk relabeling.** Existing issues keep their labels. New issues should use the `type:` taxonomy.
3. **AI-orchestrator-friendly.** Labels use consistent namespaced prefixes for machine readability.
4. **Owner retains control.** Sensitive label operations (deletion, mass replacement) require explicit owner approval.

---

## Type Taxonomy (`type:`)

Use exactly one `type:` label per issue to classify the nature of work.

| Label | Purpose |
|-------|---------|
| `type:bug` | Defect or regression in existing behavior. |
| `type:feature` | New user-facing or system capability. |
| `type:docs` | Documentation-only change. |
| `type:infra` | CI, repo infrastructure, build, tooling, or deployment. |
| `type:research` | Investigation or spike before implementation. |
| `type:validation` | Evidence, benchmark, QA, or verification work. |
| `type:architecture` | Architecture, ADR, or system design decision. |
| `type:technical-debt` | Cleanup, refactor, or maintainability work. |

### Legacy Equivalents

These existing labels overlap with the `type:` taxonomy. They are NOT removed, but new issues should prefer `type:` labels:

| Legacy Label | Preferred `type:` |
|-------------|-------------------|
| `bug` | `type:bug` |
| `enhancement` | `type:feature` |
| `documentation` | `type:docs` |
| `architecture` | `type:architecture` |
| `refactor` | `type:technical-debt` |
| `infrastructure`, `ci`, `tooling`, `github` | `type:infra` |
| `qa`, `qa-blocker`, `qa-infrastructure` | `type:validation` |
| `observation` | `type:research` |

---

## Priority Model

Positron uses a **dual priority model**. Both systems coexist:

### Short Form (legacy, actively used)
- `P0` — Critical / blocking
- `P1` — High priority
- `P2` — Medium priority

### Verbose Form (used on some issues)
- `priority: high` — Blockiert andere Features oder ist kritisch
- `priority: medium` — Wichtig, aber nicht dringend
- `priority: low` — Nice-to-have
- `priority:p3` — Repo/documentation/portfolio hygiene — lowest urgency

**Guidance for new issues:** Use `P0`/`P1`/`P2` for simplicity. Both forms are valid. The verbose form (`priority:`) provides more granularity at the low end.

**Consolidation:** Not yet decided. Requires owner decision. See [deprecated-label-decision-package.md](../evidence/issue-306/deprecated-label-decision-package.md).

---

## Approval / Risk Model

| Label | Meaning | When to Use |
|-------|---------|-------------|
| `approval:not-required` | No explicit owner approval required | Safe analysis/documentation tasks, GREEN_SAFE changes |
| `approval:decision-needed` | Strategic/technical decision needed before implementation | Architecture, scope, or approach unclear |
| `approval:required` | Explicit owner approval required before implementation | Risky/security/architecture changes |
| `safety` | Security and safety-related work | Any change touching auth, secrets, or system integrity |

**Note:** The approval labels serve the risk classification function. No separate `risk:` label prefix exists.

---

## State / Lifecycle Labels

Used by the Positron orchestration system:

| Label | Meaning |
|-------|---------|
| `positron:ready` | Issue is ready for AI processing |
| `positron:running` | AI is actively working on this issue |
| `positron:testing` | Issue is in testing phase |
| `positron:blocked` | Issue is blocked by dependency or decision |
| `positron:done` | Issue resolved by AI run |
| `positron:pr-created` | PR has been created for this issue |

---

## Module / Package Labels

Used to scope issues to specific code areas:

| Label | Scope |
|-------|-------|
| `app:server` | Backend server (`apps/server/`) |
| `app:web` | Frontend web app (`apps/web/`) |
| `package:github-adapter` | GitHub adapter package |
| `package:run-state` | Run state machine package |
| `package:shared` | Shared types and utilities |
| `package:speckit-adapter` | Spec Kit adapter package |

---

## Green-Safe Actions (AI Autonomy)

The AI orchestrator may perform these label operations without owner approval:

- Create new `type:` labels that don't duplicate existing concepts
- Add `type:` labels to new issues it creates
- Add `approval:not-required` to clearly safe tasks
- Add module labels to scope issues

## Yellow-Review Actions (Owner Approval Required)

These label operations require owner approval:

- Deleting any label (even if unused)
- Mass-relabeling existing issues
- Changing labels on issues the AI didn't create
- Consolidating the priority model (P0/P1/P2 vs. priority:high/medium/low)
- Replacing legacy labels (bug, enhancement, etc.) with type: equivalents on existing issues

## Red-Hold Actions (Never Without Explicit Approval)

- Deleting labels that are used on any open or closed issue
- Any destructive label operation
- Any operation that could break existing issue filters or queries

---

## References

- [Issue #306 — Backlog Hygiene](https://github.com/Mueller-Systems-Lab/Positron/issues/306)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [Deprecated Label Decision Package](../evidence/issue-306/deprecated-label-decision-package.md)
