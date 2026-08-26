# Feature Specification: Repository Polish, Easy Install, and GitHub Pages

**Issue:** #211
**Base:** `a7a33596d45343eb0bf4a429ac6d487fc9fd8b61`
**Status:** active implementation specification
**Scope:** repository presentation, documentation, demo installation, screenshots, static Pages site

## Problem

The current repository contains useful implementation and historical evidence, but its first-visit documentation mixes historical release/test claims with current main, and the documented Docker start path requires secrets and host tools even when fake mode is selected. The repository also has no verified public landing page.

## Product truth

Positron is an evidence-gated GitHub issue-to-PR orchestrator for supervised autonomous coding workflows. Positron remains the controller; LLMs remain workers. Fake/demo mode is safe for trying the UI. Productive Full Real Mode remains gated and is not claimed as generally production-ready while #308 remains open.

## User stories

### US1 — Understand current repository truth

As a first-time visitor, I can understand what Positron is, what works today, what is gated or deferred, and where historical evidence is kept.

**Acceptance:** README, status docs, architecture docs, and claims matrix use current repository evidence and do not advertise timeless fixed test counts or closed issues as open work.

### US2 — Try Positron safely

As a new user with Docker but no GitHub token, OpenCode, SpecKit, or Redis knowledge, I can run one documented command and reach a healthy fake/demo UI without editing a file or exposing credentials.

**Acceptance:** Linux quickstart is idempotent, generates local ignored credentials when required, waits for health, has clear `--help`, `--dry-run`, `--status`, and `--stop` behavior, and documents the measured fresh-clone result. Windows has equivalent script syntax/dry-run coverage where PowerShell is available.

### US3 — Inspect current UI evidence

As a reviewer, I can inspect fresh screenshots from the current demo-safe UI and see which views were actually verified.

**Acceptance:** curated screenshots contain no secrets, private paths, personal data, or misleading production state; missing/unavailable views are disclosed rather than fabricated.

### US4 — Discover the project publicly

As an open-source visitor, I can open a lightweight, accessible, mobile-safe landing page with honest product status, architecture, safety boundaries, screenshots, and a copy-ready quickstart.

**Acceptance:** `site/` is static and independently deployable under the project Pages base path `/Positron/`, has semantic headings, keyboard-visible focus, accessible contrast, alt text, reduced-motion support, no analytics/tracking, and no external font dependency.

### US5 — Publish only the static site

As the repository owner, I can deploy the landing page through an official GitHub Pages Actions workflow from protected `main` without publishing runtime artifacts.

**Acceptance:** workflow uses checkout/configure-pages/upload-pages-artifact/deploy-pages, separates build and deploy, grants only required Pages permissions, deploys on default-branch pushes, and does not publish on PR validation.

## Non-goals

- Positron production deployment or runtime release
- npm, container registry, or draft release publication
- Real Mode/provider/auth/control-plane redesign
- #308 Phase 3 or Phase 4
- history rewrite, force push, direct main push, auto-merge, or unbound merge

## Verification contract

- `git diff --check`
- relevant format/lint/build/typecheck/test gates
- demo quickstart, health, UI and route smoke
- clean-clone installation proof
- screenshot privacy and visual QA
- static link, asset, accessibility, mobile, and console checks
- secret and generated-artifact scans
- exact-head PR review and post-merge verification

