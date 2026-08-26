# Advanced installation

The root `docker-compose.yml` is for deliberate full-stack development and advanced integrations. It is not the safe first-run path.

Before starting it, provide `REDIS_PASSWORD` and `POSITRON_ADMIN_TOKEN` through a local ignored environment file or shell environment. Review the host mounts for OpenCode and SpecKit and confirm those paths are present. Keep these values out of commits, screenshots, and logs.

For real integrations, configure all of the following explicitly:

- `POSITRON_GITHUB_MODE=real` plus a least-privilege `GITHUB_TOKEN`;
- `POSITRON_SPECKIT_MODE=real` and an installed/verified SpecKit CLI;
- `POSITRON_OPENCODE_MODE=real` and an installed/verified OpenCode CLI;
- repository owner/name/default branch;
- workspace and admin safety boundaries;
- push/merge settings only after the relevant supervised approval.

The default safe values remain fake adapters, disabled push/merge, and an active merge kill switch. Do not use the advanced stack as a production deployment recipe.

