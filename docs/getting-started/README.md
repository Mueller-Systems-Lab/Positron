# Getting Started

## End-user Linux installation

For a normal Linux desktop, use the [one-command installer](../install/README.md#one-command-linux-installation). It requires Docker Engine and Compose v2, but not Git, Node.js, npm, or sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/Mueller-Systems-Lab/Positron/main/install.sh -o positron-install.sh
less positron-install.sh
bash positron-install.sh
```

The default installer already runs `doctor`, the first Docker build, health and
operator-readiness checks, and opens the UI. For later lifecycle operations use
`positron start`, `positron status`, `positron doctor`, `positron open`, and
`positron stop`. `positron uninstall` removes application files while
preserving user data and Docker volumes by default. Installation is online-only
and currently qualified for Linux x86_64. Use `--no-start` for an
installation-only run.

## Safe demo — developer/manual path

From a fresh clone with Docker Compose v2 installed:

```bash
./scripts/doctor.sh --demo
./scripts/quickstart.sh
```

The doctor is read-only. `--json` emits the stable
`positron.install-doctor.v1` contract for automation. A successful demo
doctor means the safe fake/demo path can start; it does not mean supervised
real integrations are configured.

On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quickstart.ps1
```

The demo uses fake adapters and generates local ignored credentials. It does not need a GitHub token, OpenCode, SpecKit, Redis installation, or manual file edits.

## Next steps

- `./scripts/quickstart.sh --status` checks the local stack.
- `./scripts/quickstart.sh --stop` stops it without deleting volumes.
- `./scripts/doctor.sh --supervised` reports OpenCode, SpecKit, provider,
  GitHub, repository, and safety prerequisites with remediation hints.
- Installed users configure the supervised profile with
  `positron configure supervised --repo OWNER/REPO --provider PROVIDER --model MODEL`
  and then use `positron doctor --supervised` and `positron start --supervised`.
  The plain `positron start` command always remains the fake/demo profile.
- [Installation tiers](../install/README.md) explain local Node development and advanced integrations.
- [Security](../../SECURITY.md) explains why real mode is not the default.

The quickstart prints the UI URL and health endpoint. Stop keeps the local
Docker volumes and ignored credentials so a later start can reuse demo state;
no data is removed automatically.
