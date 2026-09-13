# Luckread API Capability Completeness Contract v1.0

## 1. Purpose

The Luckread API layer is a product capability boundary, not merely a thin wrapper around Payload CMS.

The API must guarantee that every approved self-media platform capability can be consumed by browser/H5, Android, iOS and future clients without requiring clients to depend on Payload internals.

The target is:

> **Mainstream self-media platform capability coverage + more consistent APIs + shorter interaction paths + smoother high-concurrency behavior + lower client request overhead + lower infrastructure cost.**

API capability completeness is a P0 architectural requirement.

## 2. Non-Negotiable Rules

### 2.1 API Cannot Be the Product Capability Bottleneck

Every product capability approved in the Luckread Feature Matrix must have a corresponding API Contract before implementation reaches `READY`.

The system must not reach a state where:

```text
Payload has capability
        ↓
But API has no stable contract
        ↓
APP cannot use capability
```

Instead:

```text
Product Capability
      ↓
Feature Matrix
      ↓
Domain Contract
      ↓
API Contract
      ↓
Payload / Service / Worker / Queue / Cache / R2
      ↓
H5 / Android / iOS / Mini App
```

### 2.2 Clients Must Not Depend on Payload Internals

Clients must consume versioned Luckread APIs, not Payload collection internals, database schema, Payload-specific URLs or Payload implementation details.

Payload may change internally without requiring client rewrites as long as the approved API Contract remains compatible.

### 2.3 API Completeness Is Not Measured by Endpoint Count

An API is complete only when the feature's full product contract is represented, including where applicable:

- data shape;
- authentication;
- authorization;
- lifecycle operations;
- pagination/cursors;
- consistency model;
- error model;
- idempotency;
- rate limits;
- risk controls;
- cache behavior;
- high-concurrency behavior;
- cost model;
- acceptance criteria.

### 2.4 API Must Be Cost-First

API design must minimize unnecessary Worker executions and D1 reads/writes.

Preferred order:

```text
Avoid unnecessary requests
        ↓
Return required data together where justified
        ↓
Cache repeated reads
        ↓
Use cursor/incremental retrieval
        ↓
Aggregate high-frequency events
        ↓
Queue asynchronous work
        ↓
Batch persistent writes
```

Convenience endpoints must not create unnecessary database or Worker work.

## 3. Product Capability Coverage

The API capability matrix must cover, at minimum, the following product domains.

| Domain | Required capability families |
|---|---|
| Identity | registration, login, session, logout, account, profile, device, permissions |
| Creator | creator profile, verification, content ownership, statistics, permissions, revenue relationship |
| MCN / Organization | organization, members, roles, creator relationships, content ownership, revenue allocation, analytics |
| Content | article, dynamic post, gallery, Q&A, novel, comic, drama, audio, video, live, app/game references |
| Media | upload, metadata, poster, thumbnail, processing state, object references |
| Video | upload, processing, playback metadata, subtitles, moderation, statistics |
| Interaction | like, unlike, comment, reply, favorite, unfavorite, follow, unfollow, share, reaction |
| Safety | report, block, abuse feedback, moderation state, risk-aware interaction behavior |
| Feed | home feed, following feed, topic feed, pagination, refresh, feedback, recommendation signals |
| Notification | likes, comments, follows, mentions, system, creator, revenue notifications |
| Search | content, creator, user, topic, video and future searchable domains |
| Commerce | advertising, subscription, rewards, revenue, ledger, settlement, creator/MCN allocation |
| Apps | app, version, release, distribution, install/open/update, rating/review |
| Developer | developer, organization, permissions, manifest, API/SDK, review, analytics |
| Live | room, lifecycle, audience, interaction, playback/replay contracts |
| IM | conversations, messages, read state, relationship and delivery contracts |
| Mini App | app manifest, permissions, lifecycle, entry points, distribution |
| Games | game metadata, versions, launch/distribution, user-facing game APIs |

The matrix is extensible. New product capabilities must add API coverage before implementation.

## 4. APP Capability Completeness Gate

A feature cannot enter `READY` unless the following chain exists:

```text
Feature
  ↓
Domain owner
  ↓
Logical data contract
  ↓
API contract
  ↓
Permission model
  ↓
Risk / abuse model
  ↓
Cost model
  ↓
Performance model
  ↓
Acceptance tests
```

The API review must answer:

1. Can H5 consume the feature without Payload-specific knowledge?
2. Can Android consume the same contract?
3. Can iOS consume the same contract?
4. Are the main user journeys covered without excessive request chaining?
5. Are write operations idempotent where retries can occur?
6. Is pagination or incremental retrieval defined where lists can grow?
7. Is consistency explicitly defined?
8. Is high-frequency behavior separated from authoritative writes?
9. Are risk controls represented?
10. Can the API evolve without forcing a breaking client release?

## 5. Smooth APP Experience Requirements

### 5.1 Minimize Request Chaining

The API should support product-oriented read models where justified.

For example, a feed/home-screen contract may return the data needed for the first render rather than requiring a client to perform a long sequence of dependent requests.

```text
Avoid:
User → Author → Content → Media → Stats → Recommendation

Prefer where justified:
User → Home/Feed Read Model
```

This does not mean creating one giant endpoint for the entire application. Response boundaries must remain bounded and domain-owned.

### 5.2 Cursor and Incremental Retrieval

Large or frequently changing lists should prefer cursor/token-based pagination where appropriate.

Supported concepts may include:

- `cursor`;
- `page_token`;
- `since`;
- `updated_at`;
- resource/version identifiers.

Offset pagination must not be used by default for very large or high-churn feeds.

### 5.3 Optimistic Interaction

User interactions such as like, favorite and follow should support low-latency client UX where product consistency permits.

```text
User action
   ↓
Immediate UI state
   ↓
API/event submission
   ↓
Async aggregation where appropriate
   ↓
Authoritative state
```

The UI must not wait for unrelated analytics, counters or recommendation processing.

### 5.4 Partial Failure Tolerance

Failure of non-critical enrichment must not unnecessarily block the core user journey.

For example, analytics/recommendation enrichment failure must not corrupt an authoritative article read or publication state.

### 5.5 Stable Error Contract

All public APIs must use a consistent error model with machine-readable codes and enough context for clients to make deterministic decisions.

Error contracts must distinguish at least:

- authentication failure;
- authorization failure;
- validation failure;
- conflict/idempotency failure;
- rate limiting;
- unavailable/degraded dependency;
- not found;
- temporary retryable failure.

## 6. High-Concurrency API Rules

High-frequency behavior must not automatically become synchronous Payload/D1 writes.

Examples:

- views;
- video plays;
- impressions;
- clicks;
- dwell;
- high-frequency counters;
- recommendation behavior;
- analytics.

Preferred flow:

```text
APP
 ↓
API
 ↓
Lightweight Event
 ↓
Cache / Queue
 ↓
Risk / Validation
 ↓
Aggregation
 ↓
Batch Persistence
```

A high-frequency API must define whether the response represents:

- accepted event;
- authoritative state;
- eventually consistent derived state;
- cached state.

The API must never imply stronger consistency than the backend can guarantee.

## 7. Risk and Recommendation Protection

API behavior events must not automatically become trusted recommendation signals.

```text
API Behavior
      ↓
Raw Event
      ↓
Risk / Trust
      ↓
Validated Event
      ↓
Quality / Trust Signal
      ↓
Recommendation Signal
      ↓
Feed / Ranking
```

The API contract must allow risk systems to distinguish relevant event context without forcing every event into a synchronous D1 write.

The platform must support controls for:

- self-view/self-like;
- coordinated accounts;
- device/IP clusters;
- repeated short-interval behavior;
- automated traffic;
- fake dwell;
- mutual boosting;
- recommendation manipulation.

Risk decisions may reduce event contribution, delay attribution, require review, restrict account behavior or remove monetization eligibility according to the Risk Contract.

## 8. API Versioning and Compatibility

Public APIs use explicit versioning:

```text
/api/v1/...
```

or the approved public gateway equivalent.

Clients must not depend on undocumented fields or Payload-specific response shapes.

Backward-compatible additions are preferred. Breaking changes require an explicit contract decision and migration plan.

API versioning must be independent from Payload upgrade versions.

## 9. API Layer Boundary

The API Worker, when introduced as a separate Worker, should remain a stable application entry layer rather than a business-code monolith.

Initial responsibility:

```text
API Worker
├── routing
├── API versioning
├── authentication
├── authorization
├── request validation
├── DTO normalization
├── response normalization
├── error model
├── request ID / tracing
├── rate limiting / abuse controls
└── domain adapters
```

It should not become the default location for:

- feed ranking;
- video transcoding;
- search engine execution;
- high-volume analytics aggregation;
- recommendation model execution;
- large notification fan-out;
- IM transport state;
- game business logic.

Those capabilities may use independent services/workers when workload and cost justify them.

## 10. API Worker Development Timing

The API Contract is defined early, but the dedicated API Worker should not be implemented before the first stable identity/authentication contract exists.

Recommended sequence:

```text
Phase 0
Architecture + Feature Matrix + API Contract rules
        ↓
Phase 1
Identity / Account / Auth
        ↓
API Worker v1 skeleton
        ↓
Phase 2
Creator / MCN
        ↓
Phase 3
Content
        ↓
Phase 4+
Media / Video / Interaction / Feed / Apps / Commerce...
```

This avoids both extremes:

- developing the API too early and repeatedly redesigning it;
- developing all business modules first and allowing each module to invent its own API conventions.

## 11. API Read-Model and Aggregation Principle

The API may expose product-oriented read models when they reduce client round trips and total infrastructure work.

A read model must not become an uncontrolled giant object or duplicate the authoritative data model without a reason.

The contract must define:

- source domains;
- cache policy;
- freshness;
- consistency;
- invalidation/versioning;
- maximum payload size;
- fallback behavior.

## 12. Cost Review for APIs

Every API endpoint or endpoint family must answer:

| Cost item | Required decision |
|---|---|
| Worker executions | request and dependency hop count |
| D1 reads | expected reads/request |
| D1 writes | expected writes/request |
| Cache | hit ratio target and invalidation |
| Queue | whether asynchronous processing is justified |
| Batch | aggregation opportunity |
| R2 | object/content offload opportunity |
| Response size | expected payload and compression strategy |
| Fan-out | whether one request triggers multiple backend calls |
| Retry | idempotency and retry amplification |
| Failure | degraded behavior |
| Risk | abuse and fraud cost |

A technically valid API that creates unnecessary Worker/D1 work is not automatically acceptable.

## 13. Acceptance Gate

API capability is `READY` only when:

- feature coverage is mapped;
- data contract is approved;
- API contract is approved;
- permissions are approved;
- risk controls are approved;
- consistency is explicit;
- cost review passes;
- performance expectations are defined;
- H5 consumption path is defined;
- future Android/iOS consumption path is compatible;
- tests and acceptance criteria exist.

A feature is not `DONE` until:

```text
Architecture PASS
    ↓
Contract PASS
    ↓
Code PASS
    ↓
CI PASS
    ↓
User Acceptance PASS
```

## 14. Frozen Product Principle

The Luckread backend must not be allowed to become more capable than its public application API in a way that leaves APP functionality inaccessible.

The target is not to clone individual competitors endpoint-for-endpoint. The target is to provide:

1. **Complete mainstream self-media product capability coverage.**
2. **A more coherent API model across content, social, creator, feed, media and monetization domains.**
3. **Fewer unnecessary client round trips.**
4. **Fast perceived interaction through optimistic and asynchronous behavior where safe.**
5. **Explicit risk/trust handling so engagement cannot trivially poison recommendation fairness.**
6. **Cost-first high-concurrency behavior with cache, aggregation, queue and batch persistence where justified.**
7. **Stable contracts that allow Payload, D1, PostgreSQL and independent Workers to evolve behind the API boundary.**

This principle is mandatory for all future feature contracts.
