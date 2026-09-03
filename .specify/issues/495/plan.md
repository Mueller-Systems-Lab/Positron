# Plan: deterministic web Docker workspace install

1. Capture immutable v0.3.0 reproduction and environment versions.
2. Run disposable Docker matrix experiments for partial/complete workspace graphs and install/lockfile combinations.
3. Apply the smallest Dockerfile-only correction supported by the matrix.
4. Add a focused regression assertion for the Docker install contract if an existing test convention supports it.
5. Run no-cache builds, Compose quickstart, clean regression checks, security/review checks, and visible headed Playwright.
6. Record evidence in #495, create one hotfix PR, and land only the qualified exact head.
