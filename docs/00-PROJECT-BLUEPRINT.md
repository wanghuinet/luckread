# Luckread Project Blueprint v1.3

## 1. Purpose

Luckread uses Payload CMS as the primary CMS/application foundation for a headless self-media platform. The architecture must remain runnable on the open-source Payload edition and must not require Payload Enterprise for core product operation.

The design target includes browser/H5 first, with Android/iOS clients later, and supports articles, galleries, dynamic posts, video metadata, creators, comments, likes, follows, bookmarks, feeds, notifications, MCN administration, live, IM, mini-app and game-related APIs as the product evolves.

This blueprint establishes two non-negotiable architectural boundaries:

1. **Payload CMS Core is an upstream dependency and must remain unmodified.**
2. **Every architecture decision must be designed from reducing Cloudflare Workers and D1 cost first.**

Correctness, security, reliability and product requirements remain mandatory; cost optimization must not violate them.

## 2. P0 Core Architectural Rules

### 2.1 Cost-First Architecture

**`COST-FIRST-ARCHITECTURE` — P0 / non-negotiable.**

Reducing Workers execution and D1 read/write consumption is the first architectural constraint for every feature, data model, API, service, cache and storage decision.

No component may be introduced merely because it is technically elegant, fashionable or theoretically scalable. Every additional Worker, database operation, queue, service, table, synchronization path or computation must have a clear product/operational reason and a known cost impact.

Every feature must explicitly answer:

1. Can Worker executions be reduced?
2. Can D1 reads be reduced?
3. Can D1 writes be reduced?
4. Can repeated reads be served by cache?
5. Can high-frequency events be aggregated?
6. Can asynchronous processing remove synchronous work?
7. Can writes be batched?
8. Can R2 be used where object storage is more appropriate than D1?
9. Is every introduced service actually necessary?

Preferred optimization order:

```text
Avoid unnecessary work
        ↓
Cache repeated reads
        ↓
Aggregate high-frequency events
        ↓
Queue asynchronous work where justified
        ↓
Batch persistent writes
        ↓
Persist only required authoritative state
```

Cost optimization must not compromise required data correctness, security, abuse prevention or durability.

### 2.2 Payload Core Immutability

**`PAYLOAD-CORE-IMMUTABILITY` — P0 / non-negotiable.**

The official Payload CMS Core is never modified, forked, patched, copied into the application, or used as a location for Luckread business code.

This includes:

- `node_modules/payload` and other upstream Payload packages;
- Payload internal source files;
- copied Payload internal modules;
- local patches that change Payload Core behavior;
- business code inserted into Payload internals;
- a private Payload fork maintained only for Luckread business requirements.

Payload upgrades must be possible by replacing the upstream Payload version rather than manually merging Luckread modifications into Payload Core.

### 2.3 Supported Payload Extension Points Only

Luckread may extend Payload only through supported mechanisms, including where appropriate:

- `payload.config.ts` configuration;
- Collections;
- Globals;
- Access Control;
- Hooks for bounded, local domain behavior;
- Custom Components;
- official/plugin extension mechanisms;
- application-owned APIs and services surrounding Payload.

Hooks are lightweight extension points, not a business orchestration engine.

### 2.4 Payload Responsibility: Authoritative Basic Data

Payload is responsible for low-frequency, authoritative, structured business data and CMS operations.

Typical Payload-owned data includes:

- users and account profile state;
- author/creator profiles;
- articles;
- dynamic posts;
- video metadata;
- categories and tags;
- content publication state;
- drafts and versions;
- CMS administration;
- permissions and access control;
- other authoritative content metadata.

Payload should not synchronously persist every high-frequency user behavior.

### 2.5 High-Volume Async Write Rule

High-frequency, aggregatable and latency-tolerant behavior must not become a synchronous Payload/D1 write for every user action.

Examples include:

- article views;
- video plays;
- impressions;
- clicks;
- dwell/engagement events;
- high-frequency counters;
- recommendation behavior;
- analytics events;
- notification fan-out events.

Preferred flow:

```text
User Behavior
     ↓
Lightweight Event
     ↓
Cache / Queue
     ↓
Aggregation / Validation
     ↓
Batch Processing
     ↓
Minimal Persistent Writes
```

For example, one million views must not imply one million D1 `UPDATE` operations. The implementation should aggregate events and persist the smallest correct representation practical.

## 3. Architecture Layers

```text
Client
  |
  v
Public API / Application Layer
  |
  +-------------------------+
  |                         |
  v                         v
Payload CMS             Async Processing
  |                         |
  |                         +-- behavior events
  |                         +-- counters
  |                         +-- risk validation
  |                         +-- recommendation signals
  |                         +-- analytics
  |                         +-- other justified high-volume work
  |
  +-- Admin CMS
  +-- Auth / users
  +-- authoritative content
  +-- CRUD
  +-- access control
  +-- bounded workflows
  +-- versions / drafts
  |
  +-------------------------+
                            |
                            v
                    Cache / Queue / Events
                            |
                            v
                    Aggregation / Batch
                            |
                            v
                    Storage Contracts
                    +-- D1 initially
                    +-- PostgreSQL target
                    +-- R2 for objects
```

Not every asynchronous capability requires a separate Worker from day one. Service boundaries must be determined by workload, cost and operational necessity.

## 4. Payload Extension and Business Code Ownership

Luckread business code belongs to Luckread-owned source areas, not Payload Core.

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
Independent async/high-volume processing where justified
```

The exact service boundary is defined separately in the service/Worker contract.

## 5. Cost Architecture

### 5.1 Worker Cost

Worker execution is a budgeted resource. Avoid unnecessary request hops, synchronous chains and repeated computation. Prefer cache hits, local validation, event aggregation and asynchronous processing when correctness permits.

### 5.2 D1 Cost

D1 reads and writes are budgeted resources. A convenient database field must not automatically become a per-request write path.

The data model must distinguish authoritative state from high-frequency derived counters and events.

### 5.3 Cache

Cache exists both for latency and for reducing repeated Worker work and D1 reads.

Hot data should have an explicit cache strategy where the consistency model permits it.

### 5.4 Queue

Queueing is justified when it reduces synchronous work, absorbs bursts, or enables aggregation/batching. A queue must not be introduced when its cost and operational complexity exceed its measurable benefit.

### 5.5 Batch Persistence

High-frequency counters/events should default to aggregation followed by batched persistence when correctness permits.

```text
N user events
      ↓
aggregation
      ↓
small number of writes
```

Batch interval, thresholds and durability guarantees belong in the relevant contracts and must be load/cost tested.

### 5.6 R2

Large objects and suitable immutable/content payloads should use R2 where this reduces unnecessary D1 storage and I/O. D1 remains the authoritative metadata/state store where appropriate.

## 6. High-Volume Behavior and View Count

User behavior is treated as an event stream rather than an immediate authoritative counter mutation.

```text
User Action
    ↓
Raw Event
    ↓
Cache / Queue
    ↓
Risk / Validation
    ↓
Validated Event
    ↓
Aggregation
    ├── counters
    ├── analytics
    └── recommendation signals
    ↓
Batch Persistence
```

The system must conceptually distinguish:

```text
raw_events
validated_events
recommendation_signals
```

This prevents raw traffic from automatically becoming trusted recommendation input.

A view counter must not require one D1 write per view merely because a `view_count` field exists. The authoritative counting and display consistency model must be defined by contract.

## 7. Risk & Trust

Risk & Trust is a first-class capability because fraudulent engagement can distort content recommendation fairness.

```text
Behavior
   ↓
Risk & Trust
   ├── risk_score
   ├── trust_score
   ├── event_quality
   ├── fraud_probability
   └── recommendation_weight
              ↓
       Recommendation
              ↓
             Feed
```

Risk and Recommendation are logically decoupled.

Risk must address relevant abuse patterns such as self-viewing, coordinated accounts, repeated automated behavior, suspicious interaction clusters and recommendation manipulation.

Risk processing must also follow the cost-first principle: high-volume events should be cached, aggregated, sampled or queued where the Risk Contract permits, avoiding unnecessary D1 writes.

## 8. Design Considerations: Reliability, Consistency, Portability and Cost

The following risks are architectural guardrails, not optional implementation details. Each risk must be addressed in the relevant contract before production implementation.

### 8.1 Cache Stampede / Hot-Key Expiration

**Risk:** A popular article or feed item expires at the same time for many clients, causing a large concurrent miss burst and potentially overwhelming Payload/D1.

**Solution:**

- use request coalescing for hot keys where justified;
- use stale-while-revalidate instead of making every requester wait for refresh;
- add TTL jitter to avoid synchronized expiration;
- protect known hot keys with explicit origin-load controls;
- prefer cached immutable/versioned responses where possible;
- do not introduce a global distributed lock for every cache request merely to solve a theoretical stampede.

**Design rule:**

```text
Cache HIT
   ↓
Serve

Cache STALE
   ↓
Serve stale + background refresh

Cache MISS
   ↓
Request coalescing / hot-key protection
   ↓
Origin only when necessary
```

### 8.2 Cache Penetration / Cache Bypass

**Risk:** Random query parameters, malformed identifiers or unbounded request variants bypass cache and turn repeated traffic into repeated Worker/D1 work.

**Solution:**

- normalize cache keys;
- define an allowlist for cache-relevant parameters;
- ignore or reject non-semantic random parameters;
- validate identifiers before origin access;
- use negative caching for safe, stable not-found cases where appropriate;
- apply rate limiting and origin protection to abusive request patterns.

**Design rule:** Cache keys are part of the API/cache contract, not an incidental implementation detail.

### 8.3 Cache Avalanche

**Risk:** Large groups of related keys expire together, causing a synchronized origin-load spike.

**Solution:**

- use TTL jitter;
- stagger refreshes;
- use stale serving where consistency permits;
- avoid broad cache purges as a routine content-update mechanism;
- use precise invalidation/version changes for affected resources.

### 8.4 Cache Consistency and Stale Content

**Risk:** Edited, unpublished or deleted content can remain cached after the authoritative Payload/D1 state changes.

**Solution:**

- define authoritative state in Payload/D1;
- use versioned cache keys or explicit invalidation metadata;
- invalidate only affected resources/tags when supported;
- define maximum tolerated staleness per content type;
- use stronger read-after-write behavior only where the product requirement requires it.

**Design rule:** Cache is never the authoritative source of content state.

### 8.5 Search and Complex Query Overload

**Risk:** D1 can handle ordinary relational queries and suitable text search, but forcing large-scale fuzzy search, complex ranking, recommendation retrieval or analytical workloads into the primary content database can create cost and latency problems.

**Solution:**

Define a provider boundary before search becomes a bottleneck:

```text
Search Contract
      |
      +--> D1 / FTS implementation initially
      |
      +--> External Search implementation later
```

The application must not hard-code a search provider into business-domain contracts. External search is introduced only when measured workload requires it.

### 8.6 Vendor Lock-In

**Risk:** Directly coupling business logic to Cloudflare-specific APIs can make future runtime, database or storage migration unnecessarily expensive.

**Solution:**

Keep stable application-owned interfaces around infrastructure capabilities where migration value justifies the abstraction:

- `DatabaseProvider`
- `CacheProvider`
- `QueueProvider`
- `SearchProvider`
- `ObjectStorageProvider`
- runtime/environment adapter where required

The interfaces do **not** require multiple providers to be deployed now. They establish a migration boundary without creating premature infrastructure.

### 8.7 Global Write Latency

**Risk:** Global Worker execution does not make an authoritative database write globally local. A write path that must reach the authoritative primary can experience network latency for geographically distant users.

**Solution:**

- keep authoritative writes on the defined primary path;
- use cache/read replication for read-heavy workloads where appropriate;
- keep high-frequency behavior asynchronous and aggregated;
- avoid adding distributed databases solely to solve theoretical write latency;
- define which operations require immediate consistency and which tolerate eventual consistency.

### 8.8 Runtime Compatibility

**Risk:** A Worker runtime is not equivalent to a full Node.js server/container. Dependency upgrades can introduce unsupported or partially supported runtime behavior.

**Solution:**

- maintain an explicit runtime compatibility contract;
- pin and review critical runtime dependencies;
- run production-targeted build/type/test checks in CI;
- detect Node-only APIs and incompatible packages before deployment;
- do not assume local Next.js/Node success proves Worker compatibility.

### 8.9 Failure Isolation and Backpressure

**Risk:** A failure in a high-volume async path can cascade into Payload, D1 or the request path.

**Solution:**

- keep user-facing authoritative writes separated from non-critical high-volume processing;
- use bounded retries with backoff;
- make events idempotent where retries are possible;
- apply queue/backpressure controls where bursts exceed processing capacity;
- ensure failure of analytics/recommendation enrichment does not corrupt authoritative content state;
- define dead-letter/recovery behavior in the relevant reliability contract.

### 8.10 Recommendation Fairness and Abuse

**Risk:** Raw views, likes, follows or dwell events can be artificially generated and distort recommendation ranking, creator exposure and platform incentives.

**Solution:**

Never treat raw behavior as automatically trusted ranking input.

```text
raw_events
    ↓
Risk / Validation
    ↓
validated_events
    ↓
quality / trust signals
    ↓
recommendation_signals
    ↓
Ranking / Feed
```

Risk decisions should support graded responses such as normal, suspicious, high-risk and confirmed abuse. The exact policy thresholds belong in the Risk & Trust Contract, not in Payload collection hooks.

### 8.11 Cost Guardrail for Reliability Features

Reliability mechanisms must themselves pass cost review.

The preferred order is:

```text
Prevent unnecessary work
        ↓
Cache / aggregation
        ↓
Stale serving / coalescing
        ↓
Queue / batch
        ↓
Targeted coordination
        ↓
Stronger distributed coordination only when measured necessary
```

A reliability mechanism that increases Worker executions, D1 operations or operational complexity without measurable benefit must not be accepted merely because it appears more robust.

## 9. Feed and Recommendation

Feed and recommendation are not Payload Core responsibilities.

They consume validated content and behavior signals:

```text
Content
   + User Interest
   + Freshness
   + Engagement Quality
   + Creator Quality
   + Risk / Trust
          ↓
       Ranking
          ↓
         Feed
```

Recommendation must not rely on raw view counts or raw interaction volume without validation.

## 10. Storage Independence

The logical business schema must not depend on D1-specific behavior.

```text
Business Requirement
       ↓
Logical Data Model
       ↓
Database Contract
       ↓
D1 implementation
       ↓
PostgreSQL implementation later
```

Primary keys, timestamps, status values, relations, indexes and constraints must be defined in the logical contract first.

## 11. Enterprise Compatibility

Enterprise capabilities remain optional and must not become a hard dependency for the core product.

```text
Capability Interface
       |
   +---+---+
   |       |
   ↓       ↓
Open    Enterprise
Source  Implementation
```

Potential capabilities include SSO, publishing workflows, visual editing, collaborative editing, AI, embedding and A/B testing.

Enterprise purchase must not replace the cost-first architecture or create a dependency that prevents normal operation without Enterprise.

## 12. Feature Cost Review Gate

Every new feature must include a cost and reliability review before implementation.

Minimum review:

| Item | Required decision |
|---|---|
| Worker execution | expected work/request pattern |
| D1 reads | expected reads per user action |
| D1 writes | expected writes per user action |
| Cache | hit/miss, stampede and invalidation strategy |
| Queue | whether async processing is justified |
| Batch | whether writes can be aggregated |
| R2 | whether object storage is more appropriate |
| Payload impact | effect on Payload size/complexity |
| Service count | whether a new service is actually necessary |
| Search | provider boundary and expected workload |
| Consistency | authoritative source and tolerated staleness |
| Failure | retry, backpressure and recovery behavior |
| Runtime | Worker compatibility validation |
| Migration | PostgreSQL and provider portability |

A feature that cannot explain its Worker/D1 cost, consistency and failure profile is not `READY` for implementation.

## 13. Development Sequence

```text
Product Requirement
      ↓
Architecture Review
      ↓
Capability Boundary
      ↓
Database Contract
      ↓
API / DTO Contract
      ↓
Payload / Service Boundary
      ↓
Cost Review
      ↓
Risk / Security Review
      ↓
Reliability / Consistency Review
      ↓
Test & Acceptance Contract
      ↓
READY
      ↓
Implementation
      ↓
Local Test
      ↓
GitHub
      ↓
CI
      ↓
User Acceptance
      ↓
PASS
```

No business implementation begins before the feature reaches `READY`.

## 14. Feature Lifecycle

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

## 15. Five PASS Gates

A feature is `DONE` only after all five gates pass:

1. Architecture PASS
2. Contract PASS
3. Code PASS
4. CI PASS
5. User Acceptance PASS

GitHub-approved contracts are authoritative when discussion, local files and code disagree.

## 16. Enterprise Feature Adoption Gates

An Enterprise feature may be enabled only when at least one of the following is true:

1. it materially reduces custom code;
2. it materially improves enterprise administration or governance;
3. it is required by a real production customer/workflow;
4. it provides a meaningful operational/support advantage.

Buying Enterprise must never be used as a substitute for architectural design.

## 17. Enterprise Migration Principle

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

The public API, logical schema and client-facing behavior should remain stable unless a deliberate breaking-change decision approves otherwise.

## 18. Non-Goals

This blueprint does not require:

- immediate Enterprise purchase;
- modifying Payload Core;
- maintaining a private Payload fork for business features;
- building every capability as a separate Worker immediately;
- synchronously writing every user behavior to D1;
- using a queue where caching, local aggregation or direct batching is sufficient;
- creating complex distributed infrastructure without a measured requirement;
- adding external search before measured need;
- introducing distributed locks or coordination for every request;
- sacrificing correctness, security or durability merely to reduce cost.

## 19. Decision and Status

**Status: Architecture baseline v1.3 — cost-first foundation with reliability guardrails.**

The following rules are frozen at blueprint level:

1. **Worker and D1 cost reduction is the first architectural constraint.**
2. **Payload Core is immutable and remains an upgradeable upstream dependency.**
3. **Payload handles authoritative, low-frequency, structured basic data and CMS operations.**
4. **High-frequency behavior such as views is processed asynchronously and aggregated before persistence where possible.**
5. **Cache, queue and batch processing are cost-control mechanisms, not mandatory architecture components; each must justify its own cost.**
6. **Risk & Trust is separated from Recommendation and prevents raw behavior from automatically becoming trusted recommendation input.**
7. **Cache stampede, penetration, avalanche and stale-content risks require explicit mitigation in the relevant contracts.**
8. **Search is provider-independent and must not force complex search/ranking workloads into D1 without measured justification.**
9. **Infrastructure capabilities must have migration boundaries where the abstraction provides real value, without prematurely deploying multiple providers.**
10. **Authoritative writes, eventual-consistency operations and global read paths must be explicitly classified.**
11. **Worker runtime compatibility must be validated independently from local Node.js success.**
12. **Logical database contracts remain portable to PostgreSQL.**
13. **No feature enters implementation before its contract reaches `READY`.**
14. **No architecture component is added without a measurable product, reliability, security or cost justification.**

All subsequent contracts and feature designs must comply with these rules.