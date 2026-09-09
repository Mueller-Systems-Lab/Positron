# Distribution Readiness

**Status date:** 2026-09-04
**Baseline branch:** `hardening/release-integrity-control-plane`

This document defines the minimum evidence required before Positron is presented as a supported distribution rather than an engineering/release-candidate workflow.

It does **not** claim production readiness and does not authorize unsupervised Real Mode.

## Product boundary

Positron is an evidence-gated delivery control plane for supervised AI coding workflows.

The supported value proposition is deliberately narrower than "autonomous software development":

```text
GitHub Issue
  -> specification
  -> plan
  -> tasks
  -> coding worker
  -> verification
  -> review
  -> evidence
  -> pull request
  -> explicit operator-controlled promotion
```

The controller retains authority over progression and completion. A worker response alone is never completion evidence.

## Current classification

| Area | Status | Distribution boundary |
| --- | --- | --- |
| Controller-owned issue-to-PR orchestration | PROVEN | Existing repository evidence and runtime contracts |
| Durable run/job/attempt state | PROVEN | Existing durable control-plane implementation |
| Operator cockpit | PROVEN | Existing web UI and read-only readiness projection |
| Fake/demo path | PROVEN | Safe default exploration path |
| Supervised Real Mode | PROVEN / GATED | Requires explicit configuration, credentials and safety gates |
| Unsupervised productive Real Mode | DEFERRED | Not a supported distribution claim |
| Merge automation | DISABLED BY DEFAULT | Human/operator authority remains required |
| Release artifact provenance | INCOMPLETE | See `docs/security/release-integrity.md` |
| SBOM publication | INCOMPLETE | Required before supported distribution |
| Vulnerability reporting process | PARTIAL | Existing security policy; formal distribution process still required |
| AI Act classification | REVIEW REQUIRED | Product/deployment-specific legal classification is not asserted here |
| CRA operational readiness | IN PROGRESS | See `docs/compliance/cra-readiness.md` |

## Minimum supported distribution gate

A release may be called **SUPPORTED_DISTRIBUTION** only when all of the following are true for one exact release commit:

1. version surfaces agree;
2. the Git tag resolves to the exact qualified commit;
3. release artifacts are generated from that commit;
4. SHA-256 digests are published for distributable artifacts;
5. release provenance records the exact commit and toolchain inputs;
6. a CycloneDX or SPDX SBOM is generated and retained;
7. secret scanning and dependency/license review pass;
8. demo qualification passes from a clean install;
9. supervised qualification passes in an isolated repository;
10. push remains explicit and repository-scoped;
11. merge remains disabled unless a separately reviewed product decision changes that invariant;
12. known limitations and security documentation match runtime reality.

If any item is missing, the release classification must remain `RELEASE_CANDIDATE`, `GATED`, or `DEFERRED` as appropriate.

## Distribution truth invariant

The following surfaces must not disagree:

- `package.json` and workspace versions;
- README status wording;
- living capability/status documents;
- Git tag;
- GitHub Release draft/prerelease state;
- release notes;
- installer stable-release selection logic.

A GitHub Release that is `draft=false` and `prerelease=false` is treated by the current installer as stable. Therefore release metadata must never describe the same object as "pending publication" or "release candidate".

## Supported pilot boundary

Until production deployment is separately qualified, supported external evaluation should remain:

- self-hosted;
- one explicitly configured repository;
- supervised mode;
- least-privilege credentials;
- merge disabled;
- push opt-in only;
- operator-visible evidence;
- isolated acceptance repository before use on valuable source repositories.

## Not claimed

This document does not claim:

- autonomous production operation;
- universal provider compatibility;
- elimination of human code review;
- regulatory compliance by documentation alone;
- security against every malicious or compromised model/tool;
- semantic correctness of generated code without project-specific tests.

## Related documents

- `docs/status/current-capabilities.md`
- `docs/status/known-limitations.md`
- `SECURITY.md`
- `docs/security/release-integrity.md`
- `docs/compliance/cra-readiness.md`
- `docs/architecture/evidence-gated-delivery-control.md`
