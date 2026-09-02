# Plan — Issue #489

1. Add only the minimal Quickstart/doctor path overrides needed for installed roots and state.
2. Implement `install.sh` with stable-release resolution, HTTPS download, archive safety validation, staging, required-file checks, and atomic `current` activation.
3. Implement the generated thin CLI, version metadata, conservative uninstall, and optional XDG desktop entry.
4. Add deterministic shell tests with fake network/runtime commands covering positive, negative, security, idempotency, and preservation behavior.
5. Update README, getting-started, and installation docs with requirements, paths, commands, and limitations.
6. Run targeted checks, repository regression, fresh supported-Linux qualification where available, independent review evidence, and visible headed Playwright last.

## Review gate

No product code is added until this spec, plan, and task list exist. No merge/release is performed by the implementation run.
