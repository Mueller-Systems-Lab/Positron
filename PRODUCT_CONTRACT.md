# Positron Product Contract

Version: `positron.product-contract.v1`

## Mission

Positron is the evidence-gated software-delivery control plane that turns an
existing GitHub repository or a validated project blueprint into a governed
software project and drives work from specification through a verified Pull
Request while Positron remains the single lifecycle authority.

```
Existing Repository OR Blueprint
  -> Project Baseline -> SpecKit -> Issue / Intent -> Specify -> Plan -> Tasks
  -> Worker Routing -> Implementation -> Verification -> Review -> Evidence
  -> Pull Request -> Operator Gate
```

## Authority and boundaries

Positron owns lifecycle state, repository policy, worker routing, gates,
verification, evidence, and consequential GitHub mutations. LLMs and external
workers are workers only: they cannot self-approve, self-promote, bypass a
gate, mutate lifecycle state outside a contract, or merge without an explicit
operator gate. Adapters provide capability; they do not create a second
controller.

The canonical entry contracts are `existing_repository` and `blueprint`.
Blueprints use the versioned contract `positron.project-blueprint.v1` and must
be validated and normalized before bounded mutations are proposed.

## Non-goals

Positron is not a generic desktop agent runtime, generic autonomous-agent
platform, generic self-improving skill ecosystem, arbitrary workflow editor,
Morpheus Desktop, a chat-first product, or a standalone observability product.

## Anti-drift rule

> POSITRON MAY NOT BECOME MORPHEUS. MORPHEUS MAY NOT BECOME POSITRON.

Positron owns software-delivery governance. Morpheus owns task-execution
runtime. Shared mechanisms do not imply shared authority. Every new capability
must name the lifecycle stage it materially improves; otherwise it is rejected,
externalized, or recorded as an explicit scope exception.

## Security and evidence invariants

Credentials cross the application only as `credential_ref`; secret values are
resolved inside the credential boundary and are never persisted in Git,
database rows, evidence, logs, screenshots, telemetry, PR comments, fixtures,
or migration manifests. Requested, selected, and executed provider/model
identities are separate evidence fields. Progression requires durable evidence
for intent, specification, plan, tasks, worker, attempt, diff, verification,
review, and PR authorization.
