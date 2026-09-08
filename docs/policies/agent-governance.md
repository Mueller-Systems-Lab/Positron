# Positron agent governance

This policy holds project-specific rules that are too detailed for the
navigator. The constitution remains authoritative for general workflow,
evidence, controlled autonomy, security, and human override.

## Protected operations

- Work in the repository root. Do not create sibling clones or worktrees.
- An isolated worktree requires explicit human approval and belongs only under
  `.agent-worktrees/`.
- Never write to or push `main`/`master`; use `positron/issue-<number>-<slug>`.
- Do not expose secrets, tokens, credentials, or secret-bearing runtime files.
- Do not use `sudo`, destructive broad deletes, direct GitHub REST/GraphQL,
  `curl` mutation, or `gh` mutation.
- GitHub reads and writes belong to the visible Playwright control plane.
- Do not request paid CI or other paid actions without explicit approval.

## Scope and evidence

- Resolve one active Issue scope at a time; governance bootstrap is supporting
  work and cannot replace product/release acceptance.
- Preserve pre-existing user work and reject out-of-scope/generated changes.
- Use the completion matrix to drive unresolved work; do not infer completion
  from a single package test or from a worker's report.
- Every phase needs reproducible evidence: tests, build/lint/typecheck status,
  diff summary, acceptance mapping, architecture impact, and residual risks.
- Record durable evidence in `docs/evidence/`; runtime state stays in ignored
  gate/run state paths.

## Product map

- `apps/web/` — React/Vite/Tailwind frontend
- `apps/server/` — Node/Express/TypeScript backend
- `packages/github-adapter/` — GitHub contracts and policy
- `packages/speckit-adapter/` — Spec Kit integration
- `packages/opencode-adapter/` — OpenCode integration
- `packages/run-state/` — durable state machine
- `packages/sandbox/` — worktree isolation
- `packages/shared/` — shared types and utilities

## Validation

- Root checks: `npm run format:check`, `npm run lint`, `npm run typecheck`,
  `npm run build`, `npm test`.
- Contract/integration checks: `npm run test:contracts`,
  `npm run test:integration`, `npm run test:transfer-references`,
  `npm run test:review-execution`, `npm run verify:issues all`.
- Product checks: `npm run test:installer`, `npm run test:e2e`.
- Do not skip a mandatory suite; classify an inapplicable suite explicitly in
  the completion matrix.
