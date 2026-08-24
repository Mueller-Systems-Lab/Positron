# Plan: RealOpenCodeAdapter execution identity binding

1. Transfer only the adapter/pipeline delta from validated source commit
   `14994e7` onto current `origin/main`.
2. Verify the explicit CLI argument construction and fail-closed model path.
3. Verify structured error redaction, P5.3 diagnosis/routing, and artifact
   persistence.
4. Run focused tests, build, typecheck, affected integration, secret scan,
   and diff checks.
5. Run one disposable direct real Specify through the repaired adapter.
6. Record architecture, security, and integration review evidence.
7. Open a linked PR and stop at the exact owner landing gate.
