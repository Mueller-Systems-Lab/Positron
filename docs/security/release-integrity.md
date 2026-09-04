# Release Integrity and Provenance

**Status:** REQUIRED FOR SUPPORTED DISTRIBUTION

Positron's security model depends on evidence, deterministic gates and explicit authority boundaries. The release channel must therefore provide the same standard of evidence as the runtime.

## Current gap

The existing installer accepts a published stable GitHub Release and downloads the GitHub source archive over HTTPS. It validates archive shape and rejects path traversal/symlink escape, but the current release flow does not publish a separate cryptographic digest or signed provenance manifest for the installed source archive.

That is acceptable as a documented engineering limitation, but it is not the target distribution posture.

## Required release record

Every supported distribution must retain a machine-readable record containing at least:

```json
{
  "schema": "positron.release-provenance.v1",
  "version": "vX.Y.Z",
  "commit": "<40-char git commit>",
  "tag": "vX.Y.Z",
  "artifacts": [
    {
      "name": "<artifact>",
      "sha256": "<64-char digest>"
    }
  ],
  "sbom": {
    "format": "cyclonedx-json|spdx-json",
    "sha256": "<64-char digest>"
  }
}
```

A detached signature or Sigstore-compatible attestation may be added later; no signature claim is made until such a mechanism is actually implemented and verified.

## Local release gate

The canonical release process should run locally first and must not depend on paid remote CI.

Minimum steps:

1. freeze the exact release commit;
2. verify clean worktree and expected branch/tag ancestry;
3. run the canonical build/typecheck/test/security gates;
4. generate the distribution archive or bundle from the frozen commit;
5. generate an SBOM;
6. calculate SHA-256 for every distributable artifact and the SBOM;
7. emit `positron.release-provenance.v1`;
8. verify the manifest against the artifacts in a clean temporary directory;
9. only then publish tag/release metadata;
10. independently install from the published release and verify the resulting version/provenance.

## Installer target behavior

The installer should evolve from:

```text
HTTPS_GITHUB_ONLY
```

into:

```text
HTTPS + EXPECTED_RELEASE_METADATA + SHA256_VERIFIED
```

The installer must fail closed when:

- a digest is missing for a release that claims supported-distribution status;
- an artifact digest does not match;
- version/tag/commit provenance disagrees;
- release metadata is draft/prerelease while stable installation was requested;
- a stable GitHub Release contains release-candidate wording or another truth conflict.

## SBOM

For the Node/npm workspace, generate a standards-based SBOM from the exact release dependency graph. Preferred formats:

- CycloneDX JSON;
- SPDX JSON.

The SBOM is evidence, not a vulnerability scanner and not a legal opinion about dependency licenses. Dependency/license review remains a separate release gate.

## Evidence retention

Release evidence should be immutable and keyed by version/commit, for example:

```text
docs/evidence/releases/vX.Y.Z/
  qualification.md
  provenance.json
  checksums.txt
  sbom.cdx.json
  security-review.md
```

If public distribution is discontinued, the same structure should be preserved in the private source-of-truth repository.

## No unsupported claims

Do not claim any of the following until implemented and verified:

- reproducible builds;
- signed binaries;
- SLSA level compliance;
- Sigstore provenance;
- tamper-proof distribution;
- complete dependency vulnerability coverage.
