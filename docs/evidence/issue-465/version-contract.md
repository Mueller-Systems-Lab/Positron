# Version contract

All package manifests use `0.1.0`; this is the authoritative version for the
Positron v0.1.0 release target. Existing `v0.1.0-rc.1` and `v0.2.0-rc.1` tags
remain historical provenance. No version bump is part of this publication.

`package.json` is the source of truth; workspace package versions must match
it. The publication state is established by the matching annotated tag `v0.1.0` and the
non-draft, non-prerelease GitHub Release that points to the same canonical
commit. PACKAGE_VERSION_CONSISTENT=YES and DOC_VERSION_CONSISTENT=YES.
