# Advanced installation

The root `docker-compose.yml` is for deliberate full-stack development and advanced integrations. It is not the safe first-run path. Installed operators should use `positron configure supervised`, which delegates to this existing stack without requiring knowledge of its location or mount details.

Before starting it, provide `REDIS_PASSWORD` and `POSITRON_ADMIN_TOKEN` through a local ignored environment file or shell environment. Review the host mounts for OpenCode and SpecKit and confirm those paths are present. Keep these values out of commits, screenshots, and logs.

For repository development, configure all of the following explicitly:

- `POSITRON_GITHUB_MODE=real` plus a least-privilege `GITHUB_TOKEN`;
- `POSITRON_SPECKIT_MODE=real` and an installed/verified SpecKit CLI;
- `POSITRON_OPENCODE_MODE=real` and an installed/verified OpenCode CLI;
- repository owner/name/default branch;
- workspace and admin safety boundaries;
- push/merge settings only after the relevant supervised approval.

The default safe values remain fake adapters, disabled push/merge, and an active merge kill switch. Do not use the advanced stack as a production deployment recipe.

The supported installed workflow is:

```bash
positron configure supervised --repo OWNER/REPO --provider PROVIDER --model MODEL --github-token-file PATH
positron doctor --supervised
positron start --supervised
```

The token file is never printed and must be mode 0600. `--allow-push` is an
explicit opt-in for the configured repository; merge remains disabled. The
plain `positron start` command always starts the isolated fake/demo profile.
