# Installation

| Tier | Use when | Requirements | Mode |
| --- | --- | --- | --- |
| Try Positron | explore the UI safely | Docker Compose v2 | fake/demo |
| Local development | edit and test the repository | Node.js 22+, npm | fake by default |
| Advanced integrations | deliberate supervised adapter work | GitHub token, OpenCode, SpecKit, Redis/host config | explicit real/gated |

Start with [Getting Started](../getting-started/README.md). The advanced path is documented in [advanced.md](advanced.md).

Before either path, use `./scripts/doctor.sh --demo` for a read-only
preflight. Use `./scripts/doctor.sh --supervised` only when preparing explicit
integrations; a blocked supervised result is expected until the required
tools and configuration exist.
