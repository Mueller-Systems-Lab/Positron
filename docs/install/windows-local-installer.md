# Windows installation

The recommended Windows first run is the fake/demo quickstart. It keeps the same safe defaults as Linux and does not require a GitHub token, OpenCode, SpecKit, Redis installation, or manual environment-file editing.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quickstart.ps1
```

Useful commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quickstart.ps1 -Help
powershell -ExecutionPolicy Bypass -File .\scripts\quickstart.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File .\scripts\quickstart.ps1 -Status
powershell -ExecutionPolicy Bypass -File .\scripts\quickstart.ps1 -Stop
```

The script detects Docker Desktop and Compose v2, creates a local ignored credential file when needed, starts only the demo-safe Compose project, waits for service health, and reports the local UI URL. `-DryRun` performs prerequisite and command validation without starting containers. The repository's Windows CI or a local PowerShell run is the source of truth for portability; this document does not claim a Windows runtime result that has not been executed.

## Local Node development

For contributors who want hot reload instead of containers:

```powershell
npm ci
npm run build
npm run dev:server
# another PowerShell window
npm run dev:web
```

Keep all adapter modes fake unless you are intentionally following the [advanced installation guide](advanced.md).

## Advanced Docker path

The root `docker-compose.yml` is an advanced full-stack path. It requires explicit `REDIS_PASSWORD` and `POSITRON_ADMIN_TOKEN` values and may mount host OpenCode/SpecKit paths. It is not the first-run installer and is not a production deployment recipe.

