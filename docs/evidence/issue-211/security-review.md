# Issue #211 — Security Review Baseline

**Role:** Security delegated workstream
**Provider/model:** OpenAI / GPT-5
**Base:** `a7a33596d45343eb0bf4a429ac6d487fc9fd8b61`

## Required invariants

| Check | Decision |
| --- | --- |
| Secret exposure | generated local credentials only; never print or commit |
| Demo mode | fake adapters, no GitHub token, no OpenCode/SpecKit host mounts |
| Push | disabled |
| Merge | disabled; kill switch enabled |
| Fix loop | disabled in demo; bounded by existing runtime policy elsewhere |
| Redis | internal network only, password required in Compose |
| Pages workflow | `contents: read`, `pages: write`, `id-token: write`; no unrelated write permissions |
| Third-party actions | official GitHub actions only, immutable commit pins |
| Tracking | no analytics, pixels, remote fonts, or ad scripts |
| Screenshots | scan for tokens, private paths, personal data, hostnames, and local IPs |

## Review status

**PASS for the selected architecture, pending implementation and final scans.** Any runtime/doc conflict discovered during implementation must be recorded and resolved explicitly; it must not be papered over in README prose.

