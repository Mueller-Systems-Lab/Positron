# Security Policy

## Reporting Security Issues

Do not post secrets, tokens, `.env` contents or private credentials in public issues or pull requests.

For now, report security-sensitive findings through a private maintainer channel or a minimal GitHub issue that contains no secret values.

A supported distribution requires a defined private vulnerability-intake and update process; see [CRA readiness](docs/compliance/cra-readiness.md).

## Security Model

Positron treats tool execution and write-capable automation as sensitive.

Current rules:

- Local gates are the source of truth.
- GitHub Actions is advisory-only.
- Tooling should default to deny for write-capable operations.
- Human approval is required for merges and risky actions.
- Evidence should document what was run and what changed.

## Admin Authentication (RED_HOLD remediated)

All write endpoints (POST, PUT, DELETE) require admin authentication via `POSITRON_ADMIN_TOKEN`.
Supported headers: `Authorization: Bearer <token>` or `X-Admin-Token: <token>`.
No default token — the operator must explicitly set `POSITRON_ADMIN_TOKEN`.
Fail-closed: missing/wrong token returns 401, unconfigured token returns 503.

See [docs/security/admin-auth.md](docs/security/admin-auth.md).

## Docker Security (RED_HOLD remediated)

Services are configured with hardened container boundaries including `security_opt: no-new-privileges:true` and capability dropping where defined by the current Compose configuration. Nginx and web use read-only root filesystems with tmpfs for required writable paths. Redis is internal-only with authentication and no intended public host exposure. No hardcoded admin tokens or default passwords are allowed.

The current supervised Redis startup issue is tracked separately and must be resolved without weakening the intended security boundary.

See [docs/security/docker-hardening.md](docs/security/docker-hardening.md).

## Release Integrity

A supported distribution must bind release artifacts to an exact source commit and retain cryptographic digests plus an SBOM. The current installer documents its existing HTTPS-only integrity boundary; stronger release provenance is a required distribution gate rather than an already-completed claim.

See [docs/security/release-integrity.md](docs/security/release-integrity.md) and [distribution readiness](docs/status/distribution-readiness.md).

## Production Deployment

Refer to the [production security checklist](docs/security/production-security-checklist.md) before deploying.

Production deployment is not implied by a successful demo or supervised validation run.

## MCP/OpenCode Security

MCP tools and OpenCode adapter default to fake mode. Real mode requires explicit approval gates.
All external skills follow a trust-tier system: Tier 0 (Readonly), Tier 1 (Sandboxed), Tier 2 (Human-Gate).

See [docs/security/opencode-mcp-security-policy.md](docs/security/opencode-mcp-security-policy.md).

## Supervised and Unsupervised Boundaries

Supervised Full Real Mode validation in Issue #308 is complete. That evidence does **not** authorize unsupervised productive Real Mode, production deployment, or automatic merge authority.

Current intended external-evaluation posture remains:

- explicitly configured repository;
- least-privilege credentials;
- supervised execution;
- push only through explicit opt-in;
- merge disabled by default;
- operator-visible evidence and hold states.

## Known Limitations

See [`docs/status/known-limitations.md`](docs/status/known-limitations.md).

Unsupervised productive Real Mode remains gated and is not a supported deployment claim.
GDPR/DSGVO governance and final EU regulatory classification remain open product/legal work documented in [docs/compliance/README.md](docs/compliance/README.md) and [docs/compliance/cra-readiness.md](docs/compliance/cra-readiness.md).
