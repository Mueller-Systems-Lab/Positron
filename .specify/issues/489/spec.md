# One-command local Linux installer — Specification

## Contract

The installer is `positron.installer.v1`, distributed as `install.sh` from the canonical repository URL. It resolves the current non-draft, non-prerelease GitHub stable release, downloads the GitHub source archive over HTTPS, validates its shape, and activates it atomically under user-owned XDG paths.

The release archive is treated as untrusted input. Version/tag values are allowlisted, the release host is fixed, extraction is performed into a private staging directory, and every member is checked for traversal and symlink escape before activation. No checksum is claimed because the current stable release has no digest asset or manifest.

## Runtime reuse

The installed CLI invokes the release's existing `scripts/doctor.sh` and `scripts/quickstart.sh`. A small environment override makes Quickstart's repository root and local credential state injectable; it does not add a runtime manager. Readiness is checked through `/api/operator-readiness` after Quickstart health.

## Filesystem

- application: `${XDG_DATA_HOME:-$HOME/.local/share}/positron/releases/<version>` and atomic `current` symlink
- config: `${XDG_CONFIG_HOME:-$HOME/.config}/positron`
- persistent state: `${XDG_STATE_HOME:-$HOME/.local/state}/positron`
- cache/staging: `${XDG_CACHE_HOME:-$HOME/.cache}/positron`
- launcher: `$HOME/.local/bin/positron`
- desktop entry: `${XDG_DATA_HOME:-$HOME/.local/share}/applications/positron.desktop` when a desktop session and `xdg-open` exist

Quickstart's generated demo credentials are placed in the state root and remain outside application releases. Docker volumes remain Docker-owned and are never deleted by default uninstall.

## CLI

`positron start`, `stop`, `status`, `doctor`, `open`, `version`, `uninstall`, and `help` are supported. The wrapper remains thin, uses the current release's scripts, never invokes `sudo`, and never requires Git, Node, or npm on the host.

## Failure and rollback

Failures have stable error labels and actionable text. No failure before atomic activation may modify `current`. Reinstalling the same version is idempotent. Uninstall removes application files, launcher, and desktop entry while retaining config, state, cache, and volumes by default. Update and purge are not implemented.

## Acceptance

- Linux x86_64 with Docker Engine and Compose v2 is the qualified target.
- Docker and network failures abort without damaging an existing installation.
- Unsafe archives, malicious versions, spaces in paths, and unwritable destinations are rejected.
- README's download/inspect/run flow is the canonical documented path.
