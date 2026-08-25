# Specification: RealOpenCodeAdapter execution identity binding

## Problem

The controlled #308 Phase-2 run showed that canonical real SpecKit sessions
could resolve against the controller worktree with undefined agent/model
identity. Direct provider/model controls passed, so the defect is in the
adapter invocation contract.

## Requirements

- Pass `--dir` for the fenced run workspace.
- Pass `--model` for the resolved current model; fail closed when absent.
- Pass `--agent` for the resolved task/worker agent.
- Preserve redacted structured OpenCode errors.
- Persist P5.3 HARNESS diagnosis and routing deltas.
- Persist successful real SpecKit artifacts before Review.
- Allow `--auto` only when the authorized caller explicitly enables it.
- Preserve all existing hard denies and workspace authority.

## Non-goals

No Phase 3/4 execution, production repository, merge, release, deployment,
unrelated refactor, or provider change.

## Acceptance

Focused adapter and pipeline regressions pass; a disposable direct Specify
proves workspace/model/agent binding; the controlled path reaches the proven
`pre_write/evidence_required` boundary without unauthorized external effects.
