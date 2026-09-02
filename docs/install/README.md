# Installation

## One-command Linux installation

Supported target: Linux x86_64 with Docker Engine and Docker Compose v2. The installer is online-only, needs no Git/Node/npm/root/sudo, and downloads the latest non-draft, non-prerelease GitHub release. Download it to inspect before execution:

```bash
curl -fsSL https://raw.githubusercontent.com/Mueller-Systems-Lab/Positron/main/install.sh -o positron-install.sh
less positron-install.sh
bash positron-install.sh
```

The installer uses `~/.local/share/positron` for application releases, `~/.config/positron` for configuration, `~/.local/state/positron` for generated demo credentials and runtime state, and `~/.cache/positron` for staging/cache. The launcher is `~/.local/bin/positron`. It does not edit `PATH` or shell profiles.

Commands are `positron start`, `stop`, `status`, `doctor`, `open`, `version`, and `uninstall`. `uninstall` removes application files, the launcher, and an installed desktop entry; config, state, cache, and Docker volumes remain by default. Headless systems remain supported and skip desktop integration.

Release integrity is currently `HTTPS_GITHUB_ONLY`: v0.2.0 has no published checksum asset or manifest. The installer does not invent or imply checksum verification. Offline installation and update are not implemented in v1.

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
