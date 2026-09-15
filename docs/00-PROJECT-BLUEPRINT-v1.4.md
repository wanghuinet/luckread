# Luckread Project Blueprint v1.4

> **Status: ACTIVE / CANONICAL ARCHITECTURE BLUEPRINT**
>
> Scope: Luckread Payload self-media platform.
>
> This document consolidates the architecture rules previously distributed between the Project Blueprint and `docs/01-PLATFORM-CONTRACT-v1.0.md`.
>
> **Architecture source of truth:** this document.
>
> **Functional source of truth:** `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`.
>
> **Final implementation target:** 12 Workers / 4 D1 domains / 25 Contract Tasks.

## 1. Source-of-Truth Hierarchy

```text
Functional capability
    ↓
docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md
    ↓
Architecture + final topology
    ↓
docs/00-PROJECT-BLUEPRINT-v1.4.md
    ↓
25 Contract Tasks / API / Data / Security / Runtime Contracts
    ↓
Implementation
    ↓
Tests / CI / Deployment / Smoke / Evidence
```

Rules:

1. No capability may be invented in implementation.
2. Every capability must have a Feature ID in the functional Blueprint.
3. Architecture may constrain implementation but may not silently add product capabilities.
4. Contracts must reconcile against both the functional Blueprint and this architecture Blueprint.
5. If authoritative documents conflict, implementation stops until the conflict is formally resolved.
6. Historical documents are evidence/reference unless explicitly promoted by Change Control.
7. **12 Workers / 4 D1 domains / 25 Contract Tasks are the final implementation target and must be reflected by the Mapping and contracts.**

## 2. P0 Non-Negotiable Architecture Rules

### 2.1 Cost-First Architecture

Worker execution and D1 read/write consumption are budgeted resources. Every architecture decision must first minimize unnecessary work while preserving correctness, security, reliability and durability.

Every component must answer:

- Can Worker executions be reduced without violating the 12-Worker target?
- Can D1 reads be reduced without violating the 4-D1 target?
- Can D1 writes be reduced?
- Can cache serve repeated reads?
- Can high-frequency events be aggregated?
- Can asynchronous processing remove synchronous work?
- Can writes be batched?
- Can R2 replace inappropriate D1 object storage?
- Is the component required by one of the 25 Contract Tasks or the functional Blueprint?

Preferred order:

```text
Avoid unnecessary work
        ↓
Cache repeated reads
        ↓
Aggregate high-frequency events
        ↓
Queue asynchronous work where justified
        ↓
Batch persistence
        ↓
Persist only authoritative state
```

### 2.2 Payload Core Immutability

Payload CMS Core is an upstream dependency and must not be modified, forked, patched, copied into the application, or used as a location for Luckread business code.

Luckread uses supported Payload extension points only: configuration, Collections, Globals, Access Control, bounded Hooks, Custom Components, official/plugin mechanisms, and Luckread-owned APIs/services surrounding Payload.

Hooks are bounded extension points, not the platform orchestration engine.

### 2.3 Authoritative State Boundary

Payload/application-owned persistence is authoritative for low-frequency structured business state. High-frequency telemetry, derived projections and recommendation signals are not automatically authoritative.

### 2.4 Final Topology Is Fixed

The final Luckread implementation target is:

```text
25 Contract Tasks
        ↓
12 Workers
        ↓
4 D1 Domains
```

This is the target topology for implementation and deployment. It is not a license to create arbitrary additional Workers or D1 domains.

A split inside the final topology is permitted only when it remains within the frozen target and is justified by ownership, transaction isolation, security isolation, traffic/scaling, lifecycle, capacity, operational or migration requirements.

If implementation evidence shows that the target itself must change, that is an explicit architecture change requiring Blueprint Change Control; it must not be changed implicitly during coding.

## 3. Architecture Layers

```text
Web / H5 / Android / iOS / Mini Program
                |
                v
        Canonical API Contract
                |
                v
      Public Application Boundary
          /               \
         /                 \
        v                   v
  12 Worker Runtime Set   Async/Event Processing
        |                   |
        |                   +-- behavior events
        |                   +-- counters
        |                   +-- risk validation
        |                   +-- recommendation signals
        |                   +-- analytics
        |                   +-- notifications
        |
        +-- auth/account
        +-- authoritative content
        +-- CMS/admin
        +-- access control
        +-- bounded workflows
        +-- drafts/versions
                |
                v
          4 D1 Domains + R2 + Cache + Queue + Search
```

The 12 Workers are execution boundaries. The 25 Contract Tasks define delivery responsibilities. The 4 D1 domains define the final relational storage topology. These three dimensions must be explicitly mapped rather than inferred from code.

## 4. Runtime Boundary Rules

### 4.1 Terminal Request Principle

A normal user request should terminate at one appropriate Worker/application boundary whenever practical:

```text
Client → Terminal Worker → Cache / Read Model / Authoritative Store → Response
```

The following is not a default architecture:

```text
Client → Worker A → Worker B → Worker C → Worker D → Database
```

Worker-to-Worker calls require explicit justification covering ownership, latency, failure, cost, authorization and observability, and must remain consistent with the 12-Worker target.

### 4.2 Runtime and Task Ownership

A Worker is an execution boundary. A Contract Task is a delivery/ownership boundary. They are not interchangeable.

Multiple Contract Tasks may share one Worker when the frozen Mapping permits it. A Worker may not silently acquire responsibilities belonging to another Task.

### 4.3 Payload Boundary

Payload remains the CMS/application foundation. Luckread business logic belongs in Luckread-owned source areas and supported extension points, never inside Payload Core.

## 5. Data and Storage Architecture

### 5.1 Logical-First Data Model

```text
Business Requirement
       ↓
Feature Contract
       ↓
Logical Data Model
       ↓
Data Contract
       ↓
4-Domain Data Mapping
       ↓
Provider Adapter
       ↓
D1 initially / PostgreSQL later
```

Primary keys, timestamps, states, relations, indexes, constraints, retention and audit requirements must be provider-neutral where practical.

### 5.2 D1

Luckread's final implementation target is **4 D1 domains**. Domain ownership, tables, cross-domain references, transaction boundaries and read/write rules must be frozen in the Data Mapping and Data Contracts.

D1-specific behavior must not leak into public business contracts when it creates migration coupling.

### 5.3 R2

Large objects and suitable immutable/content payloads belong in R2 where appropriate. Relational metadata and authoritative references remain in the logical data model.

Typical boundary:

```text
Content Metadata → media_id / object reference → Media Metadata → R2 Object
```

### 5.4 Cache

Cache is never the source of truth. Every cache entry must be reconstructible from authoritative or derived data.

Cache strategy must define key normalization, TTL, stale policy, invalidation/versioning, negative caching where safe, stampede protection where justified, and maximum tolerated staleness.

### 5.5 Search

Search is provider-independent:

```text
Search Contract
      |
      +--> D1 / FTS initially
      |
      +--> external provider later when measured need exists
```

Business contracts must not depend on one search vendor.

## 6. Read Architecture

Preferred public-read order:

```text
CDN / Edge Cache
      ↓
Hot Cache
      ↓
Derived / Discovery Read Model
      ↓
Authoritative Store when necessary
```

Normative rule:

> Public content traffic must not be linearly coupled to authoritative D1 reads.

Public article/image/video delivery should normally be cacheable or served from suitable read models. Sensitive permissions, payment, entitlement and private state must not rely on unsafe long-lived public caching.

## 7. Write Architecture

Preferred authoritative command path:

```text
Client
  ↓
Terminal Command Boundary
  ↓
Authoritative Transaction
  ↓
Commit
  ↓
Event / Outbox
  ↓
Queue
  ↓
Idempotent Consumers
```

The exact implementation may differ when a simpler path is demonstrably correct and cheaper, but it must remain within the 12-Worker / 4-D1 / 25-Task target.

### 7.1 Cross-Store / Cross-Domain Writes

A business operation may affect multiple storage domains, but it must not create an unbounded synchronous transaction chain.

Every cross-domain operation must define authoritative owner, local transaction boundary, event, idempotency key, consistency window, retry policy, failure state and compensation strategy where required.

> **Normative:** Cross-domain writes are allowed; unbounded synchronous multi-store transactions are forbidden.

## 8. High-Volume Async Architecture

High-frequency, aggregatable and latency-tolerant behavior must not become one synchronous database write per user action merely because a counter field exists.

Examples include views, plays, impressions, clicks, dwell events, recommendation behavior, analytics, notification fan-out and high-frequency counters.

Preferred flow:

```text
User Action → Raw Event → Cache / Queue → Risk / Validation → Validated Event
            → Aggregation → counters / analytics / recommendation signals
            → Batch Persistence
```

The architecture distinguishes `raw_events`, `validated_events` and `recommendation_signals`.

Consumers must be idempotent. Retry, backpressure and dead-letter behavior belong in the relevant runtime/reliability contract.

## 9. Risk & Trust Boundary

Risk & Trust is logically separate from Recommendation.

```text
Behavior
   ↓
Risk / Trust
   ├── risk score
   ├── trust score
   ├── event quality
   ├── fraud probability
   └── recommendation weight
          ↓
Recommendation
          ↓
Feed
```

Raw behavior must not automatically become trusted ranking input. Relevant abuse patterns include automated behavior, self-interaction, coordinated accounts, suspicious clusters and recommendation manipulation. Thresholds and enforcement policy belong in the Risk & Trust contract, not arbitrary Payload hooks.

## 10. Reliability and Failure Isolation

Reliability controls must themselves pass cost review.

### 10.1 Cache Stampede

Use request coalescing, stale-while-revalidate, TTL jitter and targeted origin protection where justified.

### 10.2 Cache Penetration

Normalize keys, validate identifiers, control cache-relevant parameters, use safe negative caching and protect abusive origin access.

### 10.3 Cache Avalanche

Stagger expirations, use TTL jitter and targeted invalidation/versioning rather than broad routine purges.

### 10.4 Failure Isolation

Non-critical analytics/recommendation enrichment must not corrupt authoritative content or financial state.

### 10.5 Retry and Backpressure

Retries are bounded and use backoff. Retryable events are idempotent. Bursts must be absorbed or rejected without cascading into the authoritative request path.

### 10.6 Runtime Compatibility

Cloudflare Worker compatibility must be tested independently from local Node.js success. CI must detect Node-only APIs and incompatible dependencies before deployment.

## 11. API Contract Boundary

Every API must bind to Feature ID, API ID/version, authentication, authorization/entitlement, input schema, output schema, error contract, Data Contract, Worker owner, consistency level, cache policy, rate limit, idempotency where applicable, tests and evidence.

An API without a canonical capability owner and Data/Security Contract is not contract-complete.

## 12. Data Contract Boundary

Every authoritative entity must declare owner, one of the 4 D1 domains where applicable, provider implementation, primary key, references, lifecycle/state machine, indexes, retention/deletion, audit requirements, migration rules, read-model behavior and cache strategy.

Schema changes require a traceable Feature/Data Contract change.

## 13. Security Contract Boundary

Every applicable API and data operation must define authentication, authorization, role, entitlement, organization/resource scope, tenant scope, rate limits, abuse protection and audit requirements.

Security invariants:

1. Client parameters cannot bypass authorization, entitlement, moderation or protected-content rules.
2. Internal APIs cannot bypass service/operator authorization boundaries.
3. Admin actions are auditable.
4. Payment success is trusted only after verified provider events.
5. Private content cannot leak through search, feed, recommendation, analytics, snippets or notifications.
6. Protected media cannot be accessed by guessing or replaying unauthorized URLs/tokens.
7. Webhooks require signature validation, replay protection and idempotency.
8. High-risk administrative, financial, moderation and migration operations are traceable.
9. Legal hold overrides normal retention deletion.
10. Stable application identifiers survive storage/provider migration.

## 14. Event Contract

Every platform event must provide, at minimum:

```text
event_id
event_type
event_version
occurred_at
aggregate_type
aggregate_id
actor_id
tenant_id
payload
trace_id
```

Events are versioned and consumers are idempotent. The exact event registry is maintained by domain contracts and must map back to Feature IDs and the responsible Worker/Task.

## 15. Final Architecture Mapping

The canonical mapping is:

```text
Feature
  ↕
25 Contract Tasks
  ↕
12 Workers
  ↕
4 D1 Domains
  ↕
API / Data / Security / Runtime / Event / Consistency
  ↕
Implementation / Test / CI / Deployment / Smoke / Evidence
```

The mapping must explicitly record:

- Feature ID
- Task ID
- Worker ID
- D1 Domain ID where applicable
- API ID/version
- Data ID
- Security ID
- Event ID where applicable
- Test ID
- Evidence ID

A missing mapping link blocks `GREEN`.

## 16. Cost Review Gate

Every feature must document, where applicable:

| Area | Required decision |
|---|---|
| Worker | expected executions and assigned Worker |
| D1 | expected reads/writes and assigned domain |
| Cache | hit target and invalidation strategy |
| Queue | why async processing is justified |
| Batch | aggregation/persistence strategy |
| R2 | object-storage suitability |
| Payload | extension/core impact |
| Search | provider and workload boundary |
| Consistency | authoritative source and staleness |
| Failure | retry/backpressure/recovery |
| Security | abuse and authorization impact |
| Runtime | production compatibility |
| Migration | PostgreSQL/provider portability |

A feature without an explainable cost, consistency and failure profile is not `READY`.

## 17. Portability and Migration

Cloudflare-specific capabilities are isolated behind replaceable application-owned boundaries where the abstraction provides real migration value:

- `DatabaseProvider`
- `CacheProvider`
- `QueueProvider`
- `SearchProvider`
- `ObjectStorageProvider`
- runtime/environment adapters where required

These interfaces do not require multiple providers to be deployed today.

Migration requirements include provider-neutral logical models, versioned migrations, migration checksum/reconciliation, stable identifiers, backward-compatible API evolution, controlled dual-read/dual-write only when required, and isolation of Cloudflare-specific behavior behind adapters.

The 4-D1 target is the initial/final Cloudflare relational topology for this implementation baseline; migration to PostgreSQL/GCP changes the provider implementation, not the public Feature/API contracts.

## 18. Enterprise Compatibility

Enterprise features remain optional and must not become a hard dependency for core operation.

```text
Capability Interface
       |
   +---+---+
   |       |
   ↓       ↓
 Open   Enterprise
 impl.    impl.
```

Enterprise adoption must materially improve product, governance, operational support or customer requirements. It must not substitute for architecture.

## 19. Feature Reconciliation

Every feature change reconciles:

```text
Feature ↔ Task ↔ Worker ↔ D1
Feature ↔ API
API ↔ Data
API ↔ Security
Data ↔ Migration
Feature ↔ Code
API ↔ Test
Feature ↔ Evidence
```

Reconciliation must detect missing APIs, missing data entities/fields, missing security policies, missing tests, missing Worker ownership, missing D1 ownership, missing evidence, orphan APIs, orphan database artifacts, orphan code, orphan tests and orphan events/cache entries.

## 20. Evidence and GREEN

Evidence cannot pass merely because a registry is non-empty.

A completed capability requires verifiable evidence connecting:

```text
Feature → Task → Worker → D1 → API → Data → Security
       → Implementation → Test → CI → Deployment → Smoke
```

Where applicable, evidence includes Feature ID, Task ID, Worker ID, D1 Domain ID, API ID, Data ID, Security ID, Test ID, commit SHA, workflow run, deployment result and smoke result.

`GREEN` requires all applicable gates:

```text
Blueprint        PASS
Feature Contract PASS
API Contract     PASS
Data Contract    PASS
Security         PASS
Runtime          PASS
Implementation   PASS
Unit Test        PASS
Integration      PASS
Contract Test    PASS
Security Test    PASS
Reconciliation   PASS
Evidence         PASS
CI               PASS
Deploy           PASS
Smoke            PASS
```

GitHub Actions green alone does not constitute platform GREEN.

## 21. Contract-First Development Sequence

```text
Blueprint
  ↓
25-Task Mapping Freeze
  ↓
12-Worker Mapping Freeze
  ↓
4-D1 Mapping Freeze
  ↓
Feature Contract
  ↓
API Contract
  ↓
Data Contract
  ↓
Security/Auth Contract
  ↓
Runtime Contract
  ↓
Event/Consistency Contract
  ↓
Cost / Reliability Review
  ↓
Implementation
  ↓
Unit / Integration / Contract / Security Tests
  ↓
Reconciliation
  ↓
Evidence Registry
  ↓
CI
  ↓
Deploy
  ↓
Smoke Verification
  ↓
GREEN
```

No implementation begins before the applicable contract reaches `READY`.

## 22. Feature Lifecycle

```text
DRAFT → ARCHITECTURE REVIEW → CONTRACT REVIEW → READY → IMPLEMENTING
      → LOCAL PASS → CI PASS → USER ACCEPTANCE → DONE
```

## 23. Final Topology Change Gate

The 12-Worker / 4-D1 / 25-Task topology is frozen for this implementation baseline.

Any request to add, remove, merge or repurpose a Worker, D1 domain or Contract Task requires explicit Blueprint Change Control and must include:

- reason and affected capabilities;
- ownership impact;
- transaction/security impact;
- cost impact;
- failure/recovery impact;
- migration impact;
- Mapping impact;
- Contract impact;
- test/evidence impact.

No topology change may be introduced implicitly through implementation.

## 24. Historical Document Treatment

Historical documents remain evidence/reference only unless explicitly promoted through Change Control.

The previous statements that treated **25 Business Contract Tasks / 12 Runtime Workers / 4 Physical D1 Domains** as historical or superseded are themselves superseded by this Blueprint revision.

The final target is now explicitly:

```text
25 Contract Tasks
12 Workers
4 D1 Domains
```

Their exact ownership and responsibility must be frozen by the Mapping before implementation.

## 25. Relationship to Functional Blueprint

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md` remains the functional capability source of truth.

This architecture Blueprint defines the final implementation topology and how those capabilities cross API, data, security, runtime, storage, event, reliability and migration boundaries.

Every new product capability must first be added to the functional Blueprint with a Feature ID. Its implementation must then map to one of the 25 Contract Tasks, one of the 12 Workers where runtime execution is required, and one of the 4 D1 domains where relational persistence is required.

## 26. Non-Goals

This Blueprint does not require Payload Core modification, a private Payload fork, one Worker per feature, synchronous persistence for every user action, a queue for every operation, external search before measured need, distributed coordination without measured need, or sacrificing correctness, security, reliability or durability for cost reduction.

It also does **not** permit silently replacing the final 12-Worker / 4-D1 / 25-Task topology with an ad hoc topology during implementation.

## 27. Canonical Decision

This v1.4 Blueprint is the canonical architecture baseline for Luckread.

**Final implementation target: 12 Workers / 4 D1 domains / 25 Contract Tasks.**

The former `docs/01-PLATFORM-CONTRACT-v1.0.md` remains historical evidence only after its migration is recorded. Domain contracts must reconcile against this Blueprint before implementation.
