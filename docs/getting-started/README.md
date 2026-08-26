# Getting Started

## Safe demo

From a fresh clone with Docker Compose v2 installed:

```bash
./scripts/quickstart.sh
```

On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quickstart.ps1
```

The demo uses fake adapters and generates local ignored credentials. It does not need a GitHub token, OpenCode, SpecKit, Redis installation, or manual file edits.

## Next steps

- `./scripts/quickstart.sh --status` checks the local stack.
- `./scripts/quickstart.sh --stop` stops it without deleting volumes.
- [Installation tiers](../install/README.md) explain local Node development and advanced integrations.
- [Security](../../SECURITY.md) explains why real mode is not the default.

