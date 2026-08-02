# Phase 10-R3-R2 Test Truth — Issue #416

**Date:** 2026-08-02
**Implementation SHA:** `3a9a116e9b214a6a9c4a284304d36da9413c243d`
**Classification:** GREEN_TEST_TRUTH_REPRODUCED

## Summary

The R3-R1 test contract was exactly reproduced at the R3-R1 merge SHA:

| Suite | Files | Passed | Failed | Skipped | Todo |
|-------|-------|--------|--------|---------|------|
| Root Vitest | 84 | 2173 | 0 | 0 | 0 |
| Web Vitest | 18 | 399 | 0 | 0 | 0 |
| **Combined Unique** | **102** | **2572** | **0** | **0** | **0** |

## File Overlap

Root and Web test files are provably disjoint (0 overlapping files).

## Command Contract

`npm test` is self-contained:
1. `pretest` → `npm run build` (TypeScript compilation of all packages)
2. Root Vitest: `vitest run` (84 files, 2173 tests, Vitest 4.1.7)
3. Web Vitest: `cd apps/web && npx vitest run` (18 files, 399 tests, Vitest 1.6.1)

## CI Contract

The `unit-tests` job performs:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 22)
3. `npm ci`
4. `npm test` (pretest → build → root + Web Vitest)

No workflow-level build step inside the job. The independent `build` job and `unit-tests.needs: build` remain.

## Host Contaminations Documented

1. **`.tsbuildinfo` persistence:** `npm run clean` does not remove `.tsbuildinfo` files. Prior builds leave cached build info that causes `tsc -b` to skip compilation. CI (fresh checkout) is not affected.

2. **`NODE_ENV=production`:** Local host `NODE_ENV=production` causes React production builds that don't support `act()`. Web Vitest requires `NODE_ENV=test` or unset. CI environments typically have `NODE_ENV` unset.

## Evidence

- Full evidence directory: Zero-Human-Company external evidence
- Machine-readable reports: T2-root-vitest.json, T3-web-vitest.json
- CI Policy: v2 (supersedes v1, effective 2026-08-02)
- Branch Protection: 6 required checks confirmed
