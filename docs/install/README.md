# Installation

## One-command Linux installation

Supported target: Linux x86_64 with Docker Engine and Docker Compose v2. The installer is online-only, needs no Git/Node/npm/root/sudo, and downloads the latest non-draft, non-prerelease GitHub release. Download it to inspect before execution:

```bash
curl -fsSL https://raw.githubusercontent.com/Mueller-Systems-Lab/Positron/main/install.sh -o positron-install.sh
less positron-install.sh
bash positron-install.sh
```

The default command continues through the safe demo journey: it runs the
read-only doctor, performs the first Docker build, starts the services, checks
health and operator readiness, and opens the local UI. Use
`bash positron-install.sh --no-start` when only the files should be installed.

The installer uses `~/.local/share/positron` for application releases, `~/.config/positron` for configuration, `~/.local/state/positron` for generated demo credentials and runtime state, and `~/.cache/positron` for staging/cache. The launcher is `~/.local/bin/positron`. It does not edit `PATH` or shell profiles.

Commands are `positron start`, `stop`, `status`, `doctor`, `open`, `version`, and `uninstall`. `uninstall` removes application files, the launcher, and an installed desktop entry; config, state, cache, and Docker volumes remain by default. Headless systems remain supported and skip desktop integration. The installer supports the published v0.2.0 contract and the v0.3.0 release-candidate supervised launcher surface.

After installation, the safe default remains unchanged. For an explicitly
supervised setup, use `positron configure supervised --repo OWNER/REPO`; add
`--github-token-file PATH` (mode 0600), or provide `GITHUB_TOKEN`/`GH_TOKEN`
from a protected environment. Provider and model can be supplied with
`--provider` and `--model`. `--allow-push` is an explicit opt-in; merge remains
disabled. Then run:

```bash
positron doctor --supervised
positron start --supervised
positron status --supervised
positron stop --supervised
```

The supervised contract is stored at
`~/.config/positron/supervised.env`, with the token at
`~/.config/positron/secrets/github-token`; both are protected with mode 0600
and their parent directories with mode 0700. `positron configure supervised`
does not start a run or change GitHub. The v0.2.0 stable archive predates this
launcher surface. The v0.3.0 release candidate is the first archive being
qualified to provide these commands.

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
