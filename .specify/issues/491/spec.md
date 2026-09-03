# Installed supervised configuration — Specification

## Contract

The installed launcher exposes `positron configure supervised`,
`positron doctor --supervised`, and profile-aware `start`, `stop`, and
`status`. It consumes a versioned local `positron.supervised-config.v1`
contract and invokes the existing advanced `docker-compose.yml` only when
`--supervised` is explicit.

## Configuration and secrets

Non-secret values live in `${XDG_CONFIG_HOME:-$HOME/.config}/positron/supervised.env`;
the GitHub token is copied from an explicitly selected secure source into
`${XDG_CONFIG_HOME:-$HOME/.config}/positron/secrets/github-token`. Direct token
arguments are rejected. Configuration directories are 0700 and files 0600;
symlinked secret targets, traversal, newlines, shell metacharacters, and
invalid `OWNER/REPO` input are rejected. Local Redis/admin secrets are generated
under protected state and are never printed.

## Profile semantics

The default `positron start` delegates only to the safe Quickstart profile
(`positron-quickstart`, fake adapters, push and merge disabled). Supervised
commands use `positron-supervised`, the existing advanced compose file, real
adapters, explicit repository coordinates, and merge disabled with the kill
switch active. Starting the profile never starts a run.

## Readiness and compatibility

`doctor --supervised` remains read-only and validates the installed contract,
Docker, host tools, and safe flags; it does not start containers or contact
GitHub with mutation authority. Supervised runtime readiness is projected from
the existing `/api/operator-readiness` contract. The release fixture must
contain the new launcher/script surface; if v0.2.0 cannot, compatibility is
explicitly reported as requiring a future stable release.

## Acceptance

- No Positron clone, internal environment variables, Compose knowledge, or
  manual config edits are needed after installation.
- Missing/invalid token, repository, OpenCode, SpecKit, provider, and model
  produce actionable blocked results without secret disclosure.
- Demo behavior is unchanged and isolated from supervised state/volumes.
- Existing advanced stack is reused; no second runtime or readiness engine is
  introduced.
- Tests cover parser, permissions, path safety, secret redaction, profile
  isolation, and launcher delegation.
