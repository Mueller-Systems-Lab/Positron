# Spec: deterministic web Docker workspace install

## Goal

Make the public web image build deterministic on a clean Docker builder while preserving the existing runtime and workspace architecture.

## Acceptance criteria

1. The v0.3.0 failure is reproduced and documented.
2. A/B/C/D experiments identify the causal combination of workspace graph and lockfile/install mode.
3. The Docker builder uses the complete workspace graph, the committed root lockfile, and `npm ci`; it does not use `npm install`.
4. Dev dependencies remain available for the Vite build.
5. Two independent no-cache web builds, the quickstart Compose web build, and a clean public-style install pass.
6. No dependency graph or runtime architecture change is introduced.

## Non-goals

No dependency upgrades, runtime redesign, installer redesign, or changes to v0.3.0.
