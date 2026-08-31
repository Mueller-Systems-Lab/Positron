# Version contract

All package manifests use `0.1.0`; this is the authoritative development
version for this candidate. Existing `v0.1.0-rc.1` and `v0.2.0-rc.1` tags are
historical. No version bump or tag creation is authorized by #465.

`package.json` is the source of truth; workspace package versions must match
it. Documentation describes this as an unreleased 0.1.0 development candidate,
not as a published release. PACKAGE_VERSION_CONSISTENT=YES and
DOC_VERSION_CONSISTENT=YES.
