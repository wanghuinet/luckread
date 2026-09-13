# Luckread Project Blueprint v1.1

## 1. Purpose

Luckread uses Payload CMS as the primary CMS/application foundation for a headless self-media platform. The architecture must remain runnable on the open-source Payload edition and must not require Payload Enterprise for core product operation.

The design target includes browser/H5 first, with Android/iOS clients later, and supports articles, galleries, video metadata, creators, comments, likes, follows, bookmarks, feeds, notifications, MCN administration, live, IM, mini-app and game-related APIs as the product evolves.

This blueprint establishes the first non-negotiable architectural boundary: **Payload CMS Core is an upstream dependency and must remain unmodified.** All Luckread-specific extensions and business capabilities must be implemented outside Payload Core through supported extension points or application-owned services.

## 2. P0 Core architectural rules

### 2.1 Payload Core immutability

**`PAYLOAD-CORE-IMMUTABILITY` — P0 / non-negotiable.**

The official Payload CMS Core is never modified, forked, patched, copied into the application, or used as a location for Luckread business code.

This includes:

- `node_modules/payload` and other upstream Payload packages;
- Payload internal source files;
- copied Payload internal modules;
- local patches that change Payload Core behavior;
- business code inserted into Payload internals;
- application-specific modifications intended to survive only by maintaining a private Payload fork.

Payload upgrades must be possible by replacing the upstream Payload version rather than manually merging Luckread modifications into Payload Core.

### 2.2 Supported extension points only

Luckread may extend Payload only through supported and intentionally exposed mechanisms, including where appropriate:

- `payload.config.ts` configuration;
- Collections;
- Globals;
- Access Control;
- Hooks for bounded, local domain behavior;
- Custom Components;
- official/plugin extension mechanisms;
- application-owned APIs and services surrounding Payload.

Hooks must remain lightweight. They must not become the central orchestration engine for feed, recommendation, risk, notification fan-out, search, video processing, live, IM or other high-volume workloads.

### 2.3 Business code ownership

Luckread business code belongs to Luckread-owned source directories, not Payload Core.

Recommended ownership boundary:

```text
Payload Core
    |
    | upstream dependency — immutable
    v
Payload Extension Layer
    |
    +-- collections/
    +-- globals/
    +-- access/
    +-- hooks/
    +-- components/
    +-- plugins/
    |
    v
Luckread Application / Domain Layer
    |
    +-- domains/
    +-- services/
    +-- api/
    +-- events/
    |
    v
Independent high-concurrency / asynchronous services
```

The exact Worker boundary is defined separately in `03-WORKER-BOUNDARY.md`.

### 2.4 Upgrade safety

Every Payload upgrade must preserve this invariant:

```text
Upgrade Payload Core
        |
        v
Run contracts + tests + CI
        |
        v
Luckread extension layer remains outside Core
```

A Payload upgrade must not require manually re-applying business patches to Payload Core.

## 3. Enterprise-ready, Enterprise-optional

Every Enterprise capability that may be useful later is represented as an explicit capability boundary/interface in the project blueprint, but the core business model and API contracts must continue to work without an Enterprise subscription.

No collection, API, database schema, or business workflow may be designed so that purchasing Enterprise later becomes a mandatory migration.

## 4. Layering

```text
Client
  |
  v
Public API / Application Services
  |
  +-------------------+
  |                   |
  v                   v
Payload Extension   Independent Services
  |                   |
  |                   +-- high-concurrency / async workloads
  |                   +-- feed / recommendation
  |                   +-- risk / trust
  |                   +-- search / indexing
  |                   +-- notification fan-out
  |                   +-- media / video processing
  |                   +-- live / IM / realtime
  |
  +-- Admin CMS
  +-- Auth / users
  +-- collections / CRUD
  +-- access control
  +-- bounded content workflow
  +-- versions / drafts
  |
  v
Storage contracts
  +-- D1 initially
  +-- PostgreSQL-compatible target
  +-- R2 for large/object content
```

Payload remains the CMS/application foundation. High-volume infrastructure is separated according to explicit contracts rather than accumulated inside Payload hooks.

## 5. Enterprise capability compatibility layer

Enterprise capabilities are treated as optional platform capabilities, not hard dependencies.

```text
Enterprise Capability Adapter
  |
  +-- Publishing Workflow
  +-- SSO
  +-- Visual Editing
  +-- Multi-user / collaborative editing
  +-- Enterprise AI
  +-- Embeddings / RAG-related capability
  +-- A/B testing
  +-- Enterprise support / operational integration
```

The application should expose stable internal concepts such as:

- `PublishingState`
- `ApprovalStep`
- `AuditEvent`
- `IdentityProvider`
- `ContentRevision`
- `ExperimentVariant`
- `AIProvider`
- `EmbeddingProvider`

The implementation may initially use Payload open-source features or application-owned services. If Enterprise is purchased later, an adapter may map these concepts to Enterprise features without changing public APIs or the logical database contract.

## 6. Capability ownership

### Payload-owned by default

- Admin CMS
- CRUD and collection management
- authentication foundation
- role/access control
- content authoring
- drafts and revisions where available in the selected edition
- media management
- localization
- validation
- ordinary content APIs

### Optional Enterprise enhancement

- enterprise SSO
- advanced publishing workflows
- visual editing experience
- collaborative editing
- enterprise AI features
- embedding/RAG-oriented CMS capabilities
- A/B testing
- enterprise support

### Application/Independent-Service-owned regardless of Enterprise

Enterprise purchase does **not** replace product-specific infrastructure such as:

- feed ranking
- recommendation
- high-volume counters
- notification fan-out
- queue processing
- search indexing architecture
- video processing pipeline
- live infrastructure
- IM infrastructure
- product-specific risk and trust control
- product-specific analytics

## 7. Database independence

The logical business schema must not depend on D1-specific behavior.

Target migration path:

```text
Business requirements
    -> Logical data model
    -> Database contract
    -> Payload collections / application services
    -> D1 implementation
    -> PostgreSQL implementation later
```

Primary keys, timestamps, status values, relations, indexes and constraints must be specified in the logical database contract first.

## 8. Payload size and dependency control

Every proposed feature must include a **Payload Size Impact** review before implementation.

| Feature | Payload | Independent Service | Size risk |
|---|---:|---:|---:|
| Users | Yes | — | Low |
| Article CMS | Yes | — | Low |
| Media Metadata | Yes | — | Low |
| Publishing | Bounded | Optional | Medium |
| Feed | No | Yes | High |
| Recommendation | No | Yes | High |
| Risk & Trust | No | Yes | High |
| Notification Fan-out | No | Yes | High |
| Search | No | Yes | High |
| Video Processing | No | Yes | High |
| Live / IM / Realtime | No | Yes | High |

A feature must not enter Payload merely because Payload provides a convenient hook or API. Ownership is decided by the contract and workload characteristics.

## 9. Risk & Trust architectural boundary

Risk & Trust is a first-class platform capability because fraudulent engagement can distort content recommendation fairness.

The core event model must distinguish observed behavior from trusted recommendation signals:

```text
raw_events
    -> validated_events
    -> event_quality / risk signals
    -> recommendation signals
    -> Feed / Recommendation
```

Raw events must not directly become trusted recommendation metrics.

Risk & Trust should provide stable signals such as:

- `risk_score`
- `event_quality`
- `trust_score`
- `recommendation_weight`
- `decision`

The Risk Engine must be decoupled from Recommendation. Payload may administer content/account state and expose review controls, but high-volume risk evaluation must not be implemented as a Payload hook orchestration engine.

Risk decisions should support graded outcomes such as normal, suspicious, high-risk and confirmed abuse, with corresponding controls such as contribution reduction, delayed attribution, review, account limits and monetization restrictions.

Detailed privacy, fingerprinting, retention and abuse-detection rules belong in the dedicated Risk & Trust Contract and security/privacy contracts.

## 10. Development sequence

1. Freeze project blueprint.
2. Freeze logical database contract.
3. Freeze Payload capability map.
4. Freeze Worker / independent-service boundary.
5. Freeze storage contract.
6. Freeze API and authorization contracts.
7. Freeze Risk & Trust contract.
8. Define tests and acceptance gates.
9. Mark the first feature `READY`.
10. Implement only a `READY` feature.
11. Accept locally and through GitHub CI.
12. Proceed feature by feature.

No new business feature should be added merely because Payload exposes a convenient API. The feature must first exist in the product roadmap and contracts.

## 11. Feature lifecycle

```text
DRAFT
  -> ARCHITECTURE REVIEW
  -> CONTRACT REVIEW
  -> READY
  -> IMPLEMENTING
  -> LOCAL PASS
  -> CI PASS
  -> USER ACCEPTANCE
  -> DONE
```

**No `READY` status means no business implementation.**

## 12. Five PASS gates

A feature is `DONE` only after all five gates pass:

1. Architecture PASS
2. Contract PASS
3. Code PASS
4. CI PASS
5. User Acceptance PASS

GitHub-approved contracts are the authoritative source when discussion, local files and code disagree.

## 13. Enterprise feature adoption gates

An Enterprise feature may be enabled only when at least one of the following is true:

1. it materially reduces custom code;
2. it materially improves enterprise administration or governance;
3. it is required by a real production customer/workflow;
4. it provides a meaningful operational/support advantage.

Buying Enterprise must never be used as a substitute for architectural design.

## 14. Enterprise migration principle

If Enterprise is purchased later, the preferred migration is:

```text
Existing application contract
        |
        v
Capability adapter
        |
        +--> Open-source implementation
        |
        +--> Enterprise implementation
```

The public API, logical schema and client-facing behavior should remain stable unless a deliberate architecture decision approves a breaking change.

## 15. Non-goals

This blueprint does not require:

- immediate Enterprise purchase;
- Enterprise-only collections;
- Enterprise-only APIs in the core product;
- rebuilding the application around proprietary CMS features;
- modifying Payload Core;
- maintaining a private Payload fork merely for business features;
- replacing all independent services with Payload;
- replacing all Payload functionality with independent services.

## 16. Decision and status

**Status: Architecture baseline v1.1 — foundational rule update.**

The following rules are now frozen at blueprint level:

1. Payload Core is immutable and remains an upstream dependency.
2. Luckread customizations use supported Payload extension points or Luckread-owned application/services code.
3. High-concurrency and asynchronous capabilities are separated by explicit service boundaries.
4. Risk & Trust is a first-class boundary and recommendation fairness signal source.
5. Database contracts remain logically portable to PostgreSQL.
6. No business feature enters implementation before its contract reaches `READY`.

The next documents must align with these rules. In particular, the database contract, Payload capability map, service boundary, test/acceptance contract and Risk & Trust contract must not introduce exceptions to `PAYLOAD-CORE-IMMUTABILITY`.