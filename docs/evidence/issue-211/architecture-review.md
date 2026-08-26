# Issue #211 — Architecture Review

**Role:** Architecture delegated workstream
**Provider/model:** OpenAI / GPT-5
**Base:** `a7a33596d45343eb0bf4a429ac6d487fc9fd8b61`

## Decision: PASS

Use a dedicated `docker-compose.quickstart.yml` for fake/demo mode. The existing `docker-compose.yml` is an advanced full-stack path whose host mounts and mandatory interpolation are meaningful only when an operator intentionally configures Redis and real integrations. Making its mounts conditional would increase the risk of changing the advanced path and still leave first-time users with secret setup.

The demo file will:

- run GitHub, SpecKit, OpenCode, and workspace adapters in fake mode;
- keep Redis internal to the Compose network;
- receive only locally generated Redis/admin credentials through an ignored env file;
- avoid host OpenCode, SpecKit, config, and home-directory mounts;
- expose only the local web and health endpoints needed for the demo;
- keep push and merge disabled and the merge kill switch enabled.

This preserves one controller authority and does not add a scheduler, provider, auth architecture, or runtime product feature.

