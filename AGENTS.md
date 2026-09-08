# Positron — Project Navigator

Repository: `Positron-Control/positron` · default branch: `main`.
Source of truth: observed repository reality, then versioned contracts/specs,
then live GitHub when available. The controller owns progression; agents are
workers.

## Workflow

Rehydrate → reality → completion matrix → local preflight → scoped mutation →
targeted tests → full local validation → product E2E → evidence validation →
content seal → commit equivalence → visible Playwright GitHub control plane →
remote read-back → G100 → `.gates/finalize.sh`.

## Files

- Contracts: `PRODUCT_CONTRACT.md`, `MIGRATION_MANIFEST.md`
- Architecture: `docs/architecture.md`, `docs/architecture/`
- Active specs: `.specify/issues/<number>/spec.md`, `plan.md`, `tasks.md`
- Evidence/policy: `docs/evidence/`, `docs/policies/`
- Completion state: `.run/<run-id>/completion-matrix.json`
- Gates: `.gates/run-gate.sh`, `.gates/commit.sh`, `.gates/finalize.sh`

## Gate entrypoints

- Start with `.gates/run-gate.sh G10`.
- Required order and state are enforced by the runner; G70 is read-only.
- Use `.gates/self-test.sh` to qualify the gate implementation.
- Use `.gates/admit-blocker.sh` only for the narrowly permitted owner/external
  terminal boundaries.

## Tools and protected operations

- Local Git/filesystem/shell: repository reality, tests, builds, evidence.
- GitHub control plane: visible Playwright browser only; no REST/GraphQL,
  `curl` mutation, or `gh` mutation.
- Never write/push `main` or `master`; use `positron/issue-<number>-<slug>`.
- Preserve user work, avoid secrets, avoid broad destructive commands, and do
  not create sibling clones; approved worktrees belong under `.agent-worktrees/`.
- Detailed governance: `docs/policies/agent-governance.md`.
- Constitution: `.specify/memory/constitution.md`.

## Test entrypoints

Root: `npm test`, `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm run build`.

Contracts/integration: `npm run test:contracts`, `npm run test:integration`,
`npm run test:transfer-references`, `npm run test:review-execution`,
`npm run verify:issues all`.

Product: `npm run test:installer`, `npm run test:e2e`.
