# Canonical system architecture

The canonical architecture is rendered from the implementation boundary in
[`system.mmd`](system.mmd). Positron is the only lifecycle controller. GitHub,
SpecKit, providers, OpenCode, tools, and workers are adapters or capabilities.

The two first-class entry modes converge at a Project Baseline. Existing
repositories are scanned and reconciled without silent overwrite. Blueprints
are validated, normalized, and then passed through an explicit repository
creation gate before SpecKit initialization.

The durable evidence chain is:

`Project -> Intent/Issue -> Spec -> Plan -> Tasks -> Worker -> Provider/Model -> Attempt -> Diff -> Verification -> Review -> Evidence -> PR -> Operator Gate`.

P5 harness evolution is an advanced, bounded control-plane capability for
evidence-based coding-worker configuration. It cannot promote a worker or
provider without deterministic evaluation evidence.
