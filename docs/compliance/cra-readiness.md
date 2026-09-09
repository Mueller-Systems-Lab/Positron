# Cyber Resilience Act Readiness

**Status:** ENGINEERING READINESS CHECKLIST — NOT LEGAL ADVICE

This document records engineering controls that may be needed when Positron is made available commercially in the EU. It does not determine the final legal classification of Positron or any specific distribution model.

## Why this is tracked now

A commercially distributed software product may fall within the EU Cyber Resilience Act (CRA) framework for products with digital elements. Some CRA obligations apply on a staged timeline, including vulnerability/incident reporting obligations before full application of the Regulation.

The legal applicability and manufacturer/operator role must be confirmed for the final product, entity and distribution channel.

## Engineering readiness controls

| Control | Status | Evidence / next action |
| --- | --- | --- |
| Product/version inventory | PARTIAL | Existing versioned releases and XDG installer |
| Exact release provenance | INCOMPLETE | Implement `positron.release-provenance.v1` |
| SBOM generation | INCOMPLETE | Generate CycloneDX/SPDX from exact release graph |
| Vulnerability intake | PARTIAL | Existing `SECURITY.md`; define supported private reporting route |
| Vulnerability triage process | INCOMPLETE | Define severity, ownership, SLA and escalation |
| Security update process | INCOMPLETE | Define supported versions and patch publication flow |
| Support period | UNDEFINED | Product/business decision required before sale |
| Incident evidence retention | PARTIAL | Existing run/evidence model; product security incident process still required |
| Dependency/license inventory | PARTIAL | npm lockfile exists; formal release review required |
| Security-by-default | STRONG BASELINE | Fake defaults, explicit real mode, disabled merge, admin auth, hardened containers |
| User security documentation | PARTIAL | Existing security docs/runbooks; supported-distribution guide required |
| End-of-support communication | UNDEFINED | Product/business process required |

## Vulnerability handling contract

Before supported distribution, define and exercise this minimum lifecycle:

```text
private report
  -> acknowledgement
  -> triage
  -> severity / exploitability assessment
  -> containment decision
  -> fix + regression test
  -> release qualification
  -> security update
  -> required external reporting if applicable
  -> retained evidence
```

No vulnerability may be marked complete only because a patch exists. The release and affected-version evidence must be recorded.

## Security support policy inputs

The supported distribution must state:

- which versions receive security fixes;
- minimum supported Docker/host/runtime versions;
- whether an installation is customer-managed or vendor-managed;
- how security updates are delivered;
- how customers receive urgent security notices;
- what data must be included in a vulnerability report without exposing secrets;
- which telemetry/logging exists and what remains local.

## AI-specific classification boundary

Do not encode `AI_ACT_NOT_APPLICABLE` as a product assumption. Positron uses a deterministic controller around model-backed workers, but the legal classification of the shipped system depends on the final product and deployment boundary.

Required pre-sale action:

```text
AI_ACT_CLASSIFICATION=LEGAL_REVIEW_REQUIRED
```

Engineering documentation should continue to distinguish:

- deterministic controller decisions;
- external/model-generated outputs;
- operator approvals;
- evidence used for promotion;
- actions that the model cannot authorize.

## Privacy / GDPR readiness

For a self-hosted product, default architecture should minimize vendor access to customer source code, prompts, logs and repository metadata. Before sale, document:

- data categories processed;
- local vs external-provider data flows;
- retention controls;
- logs/evidence that may contain personal data;
- deletion/export procedures;
- controller/processor roles for the chosen support model.

## Distribution gate

CRA/GDPR/AI Act documentation is a **release prerequisite**, not proof of compliance. A supported commercial release requires a separate legal review of the actual seller, license, support model and deployment architecture.
