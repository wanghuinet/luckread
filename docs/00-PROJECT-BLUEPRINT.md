# Luckread Project Blueprint

## 1. Purpose

Luckread uses Payload CMS as the primary CMS/application foundation for a headless self-media platform. The architecture must remain runnable on the open-source Payload edition and must not require Payload Enterprise for core product operation.

The design target includes browser/H5 first, with Android/iOS clients later, and supports articles, galleries, video metadata, creators, comments, likes, follows, bookmarks, feeds, notifications, MCN administration, live, IM, mini-app and game-related APIs as the product evolves.

## 2. Core architectural rule

**Enterprise-ready, Enterprise-optional.**

Every Enterprise capability that may be useful later is represented as an explicit capability boundary/interface in the project blueprint, but the core business model and API contracts must continue to work without an Enterprise subscription.

No collection, API, database schema, or business workflow may be designed so that purchasing Enterprise later becomes a mandatory migration.

## 3. Layering

```text
Client
  |
  v
Public API / Application Services
  |
  +-------------------+
  |                   |
  v                   v
Payload CMS        Worker Services
  |                   |
  |                   +-- high-concurrency / async workloads
  |                   +-- feed / search / notifications / processing
  |
  +-- Admin CMS
  +-- Auth / users
  +-- collections / CRUD
  +-- access control
  +-- content workflow
  +-- versions / drafts
  |
  v
Storage contracts
  +-- D1 initially
  +-- PostgreSQL-compatible target
  +-- R2 for large/object content
```

The exact Worker boundary is defined separately in `03-WORKER-BOUNDARY.md`.

## 4. Enterprise capability compatibility layer

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

## 5. Capability ownership

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

### Application/Worker-owned regardless of Enterprise

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
- product-specific risk control
- product-specific analytics

## 6. Database independence

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

## 7. Enterprise feature adoption gates

An Enterprise feature may be enabled only when at least one of the following is true:

1. it materially reduces custom code;
2. it materially improves enterprise administration or governance;
3. it is required by a real production customer/workflow;
4. it provides a meaningful operational/support advantage.

Buying Enterprise must never be used as a substitute for architectural design.

## 8. Development sequence

1. Freeze project blueprint.
2. Freeze logical database contract.
3. Freeze Payload capability map.
4. Freeze Worker boundary.
5. Freeze storage contract.
6. Freeze API and authorization contracts.
7. Define tests and acceptance gates.
8. Implement F01 Users.
9. Accept F01 locally and from GitHub.
10. Proceed feature by feature.

No new business feature should be added merely because Payload or Enterprise exposes a convenient API. The feature must first exist in the product roadmap and contracts.

## 9. Enterprise migration principle

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

## 10. Non-goals

This blueprint does not require:

- immediate Enterprise purchase;
- Enterprise-only collections;
- Enterprise-only APIs in the core product;
- rebuilding the application around proprietary CMS features;
- replacing all Workers with Payload;
- replacing all Payload functionality with Workers.

## 11. Decision

**Status: Architecture baseline — proposed for review.**

The project will proceed only after the foundational contracts are reviewed and accepted. Enterprise capability interfaces are now part of the architecture, while Enterprise itself remains optional.