# 03 — Sandbox Selection & Authorization

**Run ID:** 20260808_220525

## Sandbox Authorization

| Property | Value | Verified |
|----------|-------|----------|
| Owner | xxammaxx | ✅ gh auth status |
| Repository | positron-sandbox | ✅ gh api |
| URL | https://github.com/xxammaxx/positron-sandbox | ✅ |
| Default branch | main | ✅ |
| Private | true | ✅ |
| Archived | false | ✅ |

**Authorization:** This is the ONLY authorized target for real-mode mutations.

## Issue Ranking

| # | Title | Deterministic? | Side Effects? | Lines Changed | Verdict |
|---|-------|---------------|---------------|---------------|---------|
| #9 | feat: add countVowels utility | Yes (pure function) | None (new file) | ~20 impl + ~30 test | **SELECTED** |
| #14 | feat: add chunkArray utility | Yes | None (new file) | ~25 impl + ~40 test | Good alt |
| #13 | feat: add capitalizeWords utility | Yes | None (new file) | ~20 impl + ~30 test | Good alt |
| #2 | fix: preserve version strings in formatTitle | Yes | Modifies existing behavior | ~15 impl + existing tests | Risk: breaks neighbors |
| #6 | feat: add truncateText utility | Yes | None (new file) | ~20 impl + ~30 test | Good alt |
| #10 | feat: add removeDuplicates utility | Yes | None (new file) | ~15 impl + ~25 test | Good alt |

## Selection: Issue #9 — countVowels

**Why #9 is the safest:**
- Pure function — no side effects, no state
- New file — cannot break existing code
- 5 clear edge cases with explicit expected outputs
- RED → GREEN test cycle is trivially verifiable
- No dependency changes, no security implications
- In/out behavior is fully deterministic

**Issue details:**
```
feat: add countVowels utility to count vowels in a string
├── File: src/countVowels.ts (new)
├── Tests: tests/countVowels.test.ts (new)
├── Export from src/index.ts
└── Counts a, e, i, o, u (case-insensitive)
    ├── "hello" → 2
    ├── "" → 0
    ├── "xyz" → 0
    └── "aeiou" → 5
```
