# Positron Architecture After #447

Status: proposed/frozen for PR review on 2026-08-30. This is a consolidation
map, not a second runtime architecture.

## Canonical controller topology

```mermaid
flowchart TD
    I[GitHub Issue / Intent] --> C[Positron Controller]
    C --> R[Durable Run]
    R --> Q[Queue]
    Q --> J[Job]
    J --> A[Attempt]
    A --> P[Policy + Approval Gates]
    P --> E[Evidence Contracts]
    E --> W[Worker Adapter]
    W --> L[LLM / OpenCode / External Tool]
    L --> V[Deterministic Verification]
    V --> D[Decision / Reconciliation]
    D --> G[Bounded GitHub Effect]
    D -->|FIX / SPLIT / BLOCKED| C
```

There is one lifecycle authority: Positron. Workers return bounded results;
they cannot advance the lifecycle, approve themselves, retry blindly, promote
themselves or mutate GitHub directly.

## Adapter topology

```mermaid
flowchart LR
    C[Positron Controller] --> B[Policy + Evidence Boundary]
    B --> OC[OpenCode Adapter]
    B --> N8N[n8n Adapter]
    B --> BR[Browser Workload Adapter]
    B --> BM[Benchmark Adapter]
    B --> GH[GitHub Adapter]
    B --> PX[Proxmox Adapter]
    OC --> LLM[LLM Worker]
    N8N --> NW[n8n]
    BR --> PW[Playwright / Browser Fixture]
    BM --> EV[Evaluation Runner]
    GH --> API[GitHub API]
    PX --> VM[Bounded Runtime]
```

`n8n`, Proxmox, browser automation and benchmarks are integrations behind the
boundary. None is allowed to become a passive-observer-to-Positron controller.

## Evidence and decision flow

```mermaid
sequenceDiagram
    participant P as Positron
    participant A as Attempt
    participant W as Worker Adapter
    participant T as Deterministic Tools
    participant E as Evidence Store
    P->>A: claim with run/job/attempt identity
    A->>W: validated input contract
    W-->>A: bounded result + provenance
    A->>T: tests/build/lint/typecheck/schema checks
    T-->>E: verification contract + failure signature
    E-->>P: durable evidence reference
    P->>P: security hard block, retry/split/promotion decision
    P->>P: reconcile state and authorize bounded GitHub effect
```

## Legacy disposition map

```mermaid
flowchart TB
    X[Legacy portfolio] --> A[ABSORB: QA/evidence/workflow contract]
    X --> D[ADAPT: n8n/GHIW/Morpheus/benchmark]
    X --> R[REIMPLEMENT: mission/security concepts]
    X --> P[REFERENCE: unavailable source and historical evidence]
    X --> S[KEEP SEPARATE: OCAE bootstrap/distribution]
    X --> O[REJECT: duplicate controllers and obsolete targets]
    A --> C[Positron contracts/gates]
    D --> C
    R --> C
    P -. no runtime authority .-> C
    S -. companion boundary .-> OCAE[OpenCode-Agenten-Oekosystem]
    O -. no code path .-> C
```

## Invariants

| Invariant | Result |
|---|---|
| New control planes | `0` |
| LLM role | Worker only |
| External system authority | Adapter request only |
| Protected workflow deletion | Denied by policy |
| DeepSeek agent use | `0` |
| Paid model calls | `0` |
| Source repository mutation | `0` |
| OCAE | Separate companion OSS distribution/governance layer |
