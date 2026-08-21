# Adaptive Model Harness (P5-Vision)

> **POSITRON IS THE CONTROLLER. LLMs ARE WORKERS. LLMs ARE NOT THE CONTROLLER.**
>
> **LLM schlägt vor, Evaluation beweist, Positron befördert.**

Status: **Vision** (Issue #422) — die Architektur-Grenze ist definiert;
umgesetzt sind aktuell **P5.1** (Issue #423) und **P5.2** (Issue #424,
siehe [`durable-control-plane.md`](durable-control-plane.md), Abschnitte
P5.1 — Harness Profile Identity, Provenance & Metrics Foundation und
P5.2 — Static Model Profiles, Task Profiles & Safe Runtime Compilation).

Dieses Dokument beschreibt die P5-Vision der adaptiven Modell-Harness und
die Architektur-Grenze zwischen den Phasen. Es ist KEIN Implementierungs-
Nachweis — P5.3 und P5.4 sind bewusst noch NICHT umgesetzt (P5.1 und P5.2
sind implementiert; Details siehe Status oben und
[`durable-control-plane.md`](durable-control-plane.md)).

## Vision (Issue #422)

Positron ist der Controller; LLMs sind Worker. Ein LLM **schlägt vor**
(proposes), die deterministische Evaluation **beweist** (proves), und
Positron **befördert** (promotes) — nur auf Basis von belastbarer,
persistierter Evidenz, nie auf Basis von Vermutung oder Werbeversprechen
eines Modells.

Daraus folgt die zentrale P5-Idee:

```
LLM PROPOSES → EVALUATION PROVES → POSITRON PROMOTES
```

Ein Modell-/Harness-Profil verdient eine höhere Priorität oder einen
breiteren Einsatz erst, wenn die Control Plane es anhand realer,
persistierter Attempt-Daten (Identität, Provenienz, Metriken) belegt hat.
Ohne Evidenz gibt es keine Beförderung.

## Architektur-Grenze

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CONTROL KERNEL                              │
│  (Durable Control Plane: Run → Job → Attempt, deterministische      │
│   Gates, Decision Policy, Scheduling — LLMs besitzen KEINE          │
│   Scheduling- oder Routing-Authority)                               │
└──────────────────────────────────┬──────────────────────────────────┘
                                   ▼
                    MODEL ADAPTER LAYER (Ebene A)
            technische Runtime-/Provider-Kompatibilität
                                   ▼
               STATIC MODEL / TASK PROFILES (Ebenen B + C)
            modellbezogene Harness-Konfiguration + Aufgabenprofil
                                   ▼
          DETERMINISTIC PROFILE COMPILER (P5.2, #424 — implementiert)
            kompiliert aus statischen Profilen + Laufzeit-Kontext
                                   ▼
             EVIDENCE-BASED ROUTING (P5.3, #425 — später)
            entscheidet deterministisch über Profil-Einsatz
                                   ▼
             CONTROLLED EVOLUTION (P5.4, #426 — später)
            Promotion/Demotion von Profilen auf Basis der KPIs
```

- **Control Kernel** bleibt die unveränderte Grundlage: deterministische
  Gates, durable Attempts, Idempotenz, Lease/Fencing.
- **Model Adapter Layer** (Ebene A) und **statische Modell-/Task-Profile**
  (Ebenen B + C) sind mit P5.1 bereits als Identitäts-Metadaten erfasst
  (`provider_adapter_id/version`, `harness_profile_id/version`,
  `task_profile_id/version`).
- **P5.2 Profile Compiler**: deterministischer Compiler, der aus den
  statischen Profilen und dem Laufzeit-Kontext eine konkrete, ausführbare
  Harness-Konfiguration erzeugt. Bewusst NICHT LLM-basiert.
- **P5.3 Evidence-Based Routing**: deterministische Zuordnung von
  Attempts zu Profilen auf Basis der persistierten Profile-KPIs — keine
  LLM-Entscheidung, wer mit welchem Profil läuft.
- **P5.4 Controlled Evolution**: Promotion/Demotion von Profilen (und
  ggf. Modellen) ausschließlich auf Basis von nachgewiesener, persistierter
  Evidenz (`verified_success_rate`, `attempts_per_verified_success`,
  `time_to_verified_success_ms` …) — niemals auf Basis unbelastbarer
  Behauptungen.

## Scope-Grenze: Was P5.1 (dieses Issue) liefert

**P5.1 (Issue #423) ist das Fundament — und nur das Fundament:**

- ✅ Harness-Profile-Identität (vier Ebenen A–D, persistiert auf
  `cp_attempts`, Migration V7)
- ✅ Provenienz (`model_provenance_status`: KNOWN /
  PROVENANCE_UNAVAILABLE / LEGACY_PROFILE_UNSPECIFIED — ehrlich statt
  erfunden)
- ✅ Effektiver Harness-Fingerprint (SHA-256 über semantische
  Konfiguration, Runtime-Metadaten ausgeschlossen)
- ✅ Metrics Foundation (`computeProfileKpis`, Profile-Gruppen, verified
  success an die Control-Plane-Wahrheit gekoppelt, Kosten NOT_AVAILABLE)
- ✅ Binding vor Ausführung (`PROFILE_REF_BOUND_BEFORE_EXECUTION`,
  `EXECUTED_PROFILE_EQUALS_PERSISTED_PROFILE`)

**P5.1 liefert ausdrücklich NICHT:**

- ❌ keinen zweiten Controller (Positron bleibt die einzige
  Steuerungsinstanz)
- ❌ kein adaptives Routing (P5.3) — kein LLM und kein Algorithmus wählt
  hier Profile zur Laufzeit aus
- ❌ keine Profil-Promotion / kein Deployment von Profil-Entscheidungen
  (P5.4)
- ❌ keinen Profile-Compiler (P5.2)

Kurz: P5.1 misst und identifiziert nur. Jede spätere Phase baut auf den
persistierten, validierten und ehrlichen Daten auf.

## Abhängigkeitskette

```
P4 GREEN (Multi-Issue Scheduling)
   ↓
#423 (P5.1) — Harness Profile Identity, Provenance & Metrics Foundation   ← dieses Issue
   ↓
#424 (P5.2) — Deterministic Profile Compiler
   ↓
#425 (P5.3) — Evidence-Based Routing
   ↓
#426 (P5.4) — Controlled Evolution
```

Keine spätere Phase startet ohne die Evidenz der Vorstufe: P5.2 braucht
die validierten Profile/Identität aus P5.1; P5.3 braucht die kompilierten
Profile aus P5.2 UND die KPI-Basis aus P5.1; P5.4 braucht die Routing-
Evidenz aus P5.3.

## P5.2-Status (implementiert, Issue #424)

**P5.2 ist umgesetzt:** der deterministische Profile Compiler
(`packages/control-plane/src/profile-compiler.ts`) kompiliert statische,
versionierte Model-/Task-Profile zusammen mit der Kernel-Policy und dem
Run-Kontext in eine sichere, reproduzierbare Effective Runtime
Configuration (`positron.effective-harness.v1`). Die drei P5.2-Contracts
(`positron.model-profile.v1`, `positron.task-profile.v1`,
`positron.effective-harness.v1`) sind in `contracts.ts` registriert und
fail-closed validiert; die kompilierte Config wird über Migration V8
additiv, nullable und legacy-kompatibel auf `cp_attempts` persistiert
(`effective_harness_config`, `effective_harness_fingerprint`) und atomar
mit dem Attempt-INSERT gebunden (Live-Pfad `trackJobAttempt` +
`durable-run.ts` verify/baseline/plan/build).

**Compiler-Grenze:** effektive Permissions = **Kernel ∩ Profil**
(`KERNEL_DEFAULT_PERMISSIONS` als Kernel-Policy) — ein Profil kann die
Kernel-Policy NIE erweitern (`KERNEL_DENY_WINS`); unbekannte Profile/
Versionen, invalide Contracts und nicht unterstützte Tools/Reasoning-Modi
werden fail-closed mit Reason Code abgelehnt (kein silent downgrade, kein
Freiform-Passthrough an OpenCode).

**P5.3 (Evidence-Based Routing) und P5.4 (Controlled Evolution) sind
weiterhin NICHT umgesetzt** — siehe Scope-Grenze oben. Details zu P5.2:
[`durable-control-plane.md`](durable-control-plane.md), Abschnitt
P5.2 — Static Model Profiles, Task Profiles & Safe Runtime Compilation.

## Design-Prinzipien (gelten für alle P5-Phasen)

1. **Determinismus vor Intelligenz**: Jede Entscheidung (Routing,
   Promotion, Compilation) ist deterministisch und nachvollziehbar.
   LLMs schlagen vor — sie entscheiden nicht.
2. **Evidenz vor Behauptung**: Nichts wird befördert ohne persistierte,
   validierte Metriken. `PROVENANCE_UNAVAILABLE` / `NOT_AVAILABLE` sind
   akzeptable, ehrliche Zustände.
3. **Identität vor Optimierung**: Ohne verlässliche Identität des
   tatsächlich wirksamen Harness (Fingerprint) ist jede Optimierung
   wertlos — daher ist P5.1 die erste Stufe.
4. **Privacy by Default**: Profil-Telemetrie trägt keine Secrets; die
   API projiziert nur sichere Metadaten (kein `output_json`, keine rohen
   Contracts/Semantik).
5. **Kein zweiter Controller**: Die P5-Phasen erweitern die Control
   Plane — sie ersetzen sie nicht und führen keine parallele
   Steuerungsinstanz ein.

## Siehe auch

- [`durable-control-plane.md`](durable-control-plane.md) — Durable Control
  Plane (P3, P3.5, P4) und der implementierte P5.1-/P5.2-Status
- [`../architecture.md`](architecture.md) — Gesamtarchitektur / Blueprint
