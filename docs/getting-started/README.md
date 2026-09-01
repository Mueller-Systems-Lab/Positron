# Getting Started

## Safe demo

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
- [Installation tiers](../install/README.md) explain local Node development and advanced integrations.
- [Security](../../SECURITY.md) explains why real mode is not the default.

The quickstart prints the UI URL and health endpoint. Stop keeps the local
Docker volumes and ignored credentials so a later start can reuse demo state;
no data is removed automatically.
