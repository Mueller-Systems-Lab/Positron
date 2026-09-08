# Bootstrap hard-gate plan

1. Add a compact project navigator and a shell-only gate library/runner.
2. Implement local reality, preflight, scope, evidence and commit gates.
3. Make GitHub readiness explicitly deferrable and prohibit control-plane work
   unless it is ready.
4. Add deterministic self-tests, then qualify dependencies and run repository
   validation.
