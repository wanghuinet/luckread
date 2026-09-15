# Luckread Platform Contract v1.0

> **Status: ACTIVE BASELINE / CONTRACT-FIRST / IMPLEMENTATION GATE**
>
> Scope: Luckread Payload self-media platform.
>
> This contract consolidates the existing contract-first foundation with the current runtime and data baseline: **25 Business Contract Tasks / 12 Runtime Workers / 4 Physical D1 Domains**.

## 1. Contract-First Rule

No product implementation may start from code alone.

```text
Blueprint
  -> Feature Contract
  -> API Contract
  -> Data Contract
  -> Security/Auth Contract
  -> Runtime Contract
  -> Event/Consistency Contract
  -> Implementation
  -> Unit / Integration / Contract / Security Tests
  -> Reconciliation
  -> Evidence Registry
  -> CI
  -> Deploy
  -> Smoke Verification
  -> GREEN
```

Every capability must remain traceable across Feature, API, Data, Security, Runtime, Test and Evidence. Changes that add, modify or remove a capability must trigger reconciliation and must expose missing or orphaned artifacts.

## 2. Architecture Baseline

```text
25 Business Contract Tasks
          |
12 Runtime Workers
          |
4 Physical D1 Domains
```

These numbers have different meanings:

- **25** = business capability/contract boundaries.
- **12** = runtime execution boundaries.
- **4** = current physical authoritative/derived data domains.

The numbers must not be interpreted as request-chain length or as a permanent prohibition on future splits.

## 3. 25 Business Contract Tasks

| ID | Contract Task | Runtime |
|---|---|---|
| T01 | Payload Core | W01 |
| T02 | Identity & Account | W01 |
| T03 | Authorization & Entitlement | W01 |
| T04 | Command & Transaction | W05 |
| T05 | Event & Async | W07 |
| T06 | Content | W02 |
| T07 | Media | W06 |
| T08 | Content Read | W02 |
| T09 | Feed | W03 |
| T10 | Social | W04 |
| T11 | Notification | W07 |
| T12 | Creator / MCN | W01/W07 |
| T13 | Search | W08 |
| T14 | Index & Ranking | W09 |
| T15 | Recommendation | W09 |
| T16 | Subscription & Membership | W05 |
| T17 | Payment & Settlement | W05/W07 |
| T18 | Ads & Monetization | W11 |
| T19 | IP & Market | W10 |
| T20 | Video & Live | W06/W07 |
| T21 | Analytics & Data | W11 |
| T22 | Experimentation | W09/W11 |
| T23 | Mini-App & Open Platform | W12 |
| T24 | Game & Interactive | W12 |
| T25 | Trust, Safety & Governance | W01/W04/W07 |

## 4. 12 Runtime Worker Contract

### W01 Platform / Payload

Payload Admin, Identity, Account, Authentication, Authorization, Entitlement, Creator identity and platform configuration. Payload-native capabilities should be reused rather than duplicated. Local API authorization behavior must be explicit; no implicit authorization bypass is permitted.

### W02 Content

Article, Gallery, Draft, Revision, Category, Tag, Publish/Unpublish, Content Version and Content Read. Large body objects may reside in R2; D01 owns canonical content metadata and references.

### W03 Feed

Home, Following and Creator Feed, feed assembly, caching and read models. Feed requests must not depend on unbounded real-time scans of D01.

### W04 Social

Like, Follow, Comment, Mention and Social Graph. High-frequency interaction must not create an unbounded synchronous D1 write chain.

### W05 Transaction

Commands, transactions, orders, subscriptions, memberships, entitlements, payment state, idempotency and business state machines. Strong business state remains within an authoritative transaction boundary.

### W06 Media

Upload, image/video/audio metadata, processing state, transcoding metadata, manifests, thumbnails and R2 lifecycle. Large objects belong in R2; metadata belongs in D02.

### W07 Async / Event

Queue, events, retries, DLQ, cache invalidation, notifications and asynchronous projections. Consumers must be idempotent.

### W08 Search

Search, suggestions, search API and search projections. Search must not become a real-time scan of the business source of truth.

### W09 Index / Recommendation

Index, ranking, trending, recommendation, feed candidates and experimentation projections. Derived data must remain rebuildable.

### W10 Market / IP

IP projects, assets, listings, market, trades and incubation. Financial/trade state must use the W05 transaction authority.

### W11 Analytics / Ads

Analytics, metrics, reports, ads, campaigns, impressions, clicks and monetization. High-frequency telemetry must use asynchronous batching rather than one synchronous D1 write per event.

### W12 Open / Extension

Mini-App, Open API, Developer Platform, OAuth, Webhook and Game Extension. External APIs must expose stable contracts rather than internal persistence schemas.

## 5. Four Physical D1 Domains

### D01 Core

Authoritative Payload and core business state: Identity, Account, Content Metadata, Social, Creator/MCN, Membership, Entitlement and other core business state.

### D02 Media

Authoritative media metadata, video/audio metadata, processing state, manifests, thumbnails and R2 object references. Actual large media objects are stored in R2.

### D03 Analytics

Events, metrics, aggregations, reports and statistics. High-frequency events arrive asynchronously and may be batched.

### D04 Discovery

Search projections, feed projections, ranking, trending and recommendation data. D04 is derived/rebuildable and is not a business source of truth.

## 6. Request and Runtime Boundaries

A normal request should terminate in one terminal Worker:

```text
Client -> Terminal Worker -> Cache / Index / D1 -> Response
```

The following pattern is prohibited as a default architecture:

```text
Client -> W01 -> W02 -> W03 -> W04 -> D1
```

The 12 Workers are runtime boundaries, not mandatory synchronous hops. Service-to-service calls require explicit contract justification.

## 7. Read Contract

Preferred read path:

```text
CDN / Edge Cache
      -> Hot Cache
      -> Discovery / Read Model
      -> D1 when necessary
```

Normative invariant:

> Public Content Read MUST NOT be linearly coupled to D1 reads.

Public article, image and video delivery must not require a D1 read on every access. Cache and derived read models must be rebuildable.

Permissions, orders, payment and entitlement state must not rely on unsafe long-lived public caching.

## 8. Write Contract

Preferred write path:

```text
Client
  -> Terminal Command Worker
  -> Authoritative D1 Transaction
  -> Commit
  -> Outbox / Event
  -> Queue
  -> Async Consumers
```

Asynchronous consumers handle projections, invalidation, discovery, analytics and notifications.

## 9. Cross-D1 Write Contract

A business operation may affect multiple D1 domains, but it must not create an unbounded synchronous multi-D1 transaction chain.

Every cross-D1 operation must declare:

- authoritative D1;
- local transaction boundary;
- event;
- idempotency key;
- consistency window;
- retry policy;
- failure state;
- compensation strategy where required.

Normative rule:

> Cross-D1 Write Allowed; Unbounded Synchronous Multi-D1 Transaction Forbidden.

## 10. Content / Media Contract

```text
D01 Content
   -> media_id
   -> D02 Media
   -> R2 Object
```

D01 must not duplicate the full authoritative media model. Article metadata references media; D02 owns media facts; R2 owns large objects.

## 11. Cache Contract

Cache is not a source of truth. Cache entries must be reconstructible from authoritative or derived data.

Typical hierarchy:

```text
L1 CDN / Edge Cache
L2 Hot Cache
L3 Discovery / Read Model
L4 D1
```

Cache invalidation should be event-driven where practical.

## 12. Event Contract

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

Representative events include ContentPublished, ContentUpdated, ContentDeleted, LikeCreated, LikeRemoved, FollowCreated, FollowRemoved, CommentCreated, CommentDeleted, SubscriptionCreated, SubscriptionCancelled, OrderCreated, OrderPaid, OrderCancelled, IPProjectCreated, IPListingCreated, IPListingUpdated and IPTradeCompleted.

Every asynchronous consumer must be idempotent.

## 13. API Contract

Every API must bind to:

- Feature ID;
- API ID/version;
- authentication policy;
- authorization/entitlement policy;
- input schema;
- output schema;
- error contract;
- Data Contract;
- runtime owner;
- consistency level;
- cache policy;
- rate limit;
- idempotency requirement where applicable;
- tests;
- evidence.

An API without a canonical capability owner or Data/Security Contract is not contract-complete.

## 14. Data Contract

Every authoritative entity must declare:

- owner;
- D1 domain;
- primary key;
- references;
- lifecycle/state machine;
- indexes;
- retention/deletion;
- audit requirements;
- migration rules;
- read-model behavior;
- cache strategy.

Schema changes must be traceable to a Feature/Data Contract change.

## 15. Security Contract

Every API must explicitly define authentication, authorization, role, entitlement, organization/resource scope, tenant scope, rate limits, abuse protection and audit requirements where applicable.

Security invariants:

1. Client parameters cannot bypass authorization, entitlement, moderation or playback access.
2. Internal APIs cannot bypass service/operator authorization boundaries.
3. Admin actions are auditable.
4. Payment providers cannot directly assert trusted business success without verified provider events.
5. Private content cannot leak through search, feed, recommendation, analytics, snippets or notifications.
6. Protected media cannot be delivered by guessing or replaying unauthorized URLs/tokens.
7. Webhooks require signature validation, replay protection and idempotency.
8. High-risk administrative, financial, moderation and migration operations are traceable.
9. Legal hold overrides normal retention deletion.
10. Stable application identifiers survive storage/provider migration.

## 16. Cost Contract

Cost is a design contract, not a post-launch optimization.

High-frequency APIs must define or measure:

- D1 reads/request;
- D1 writes/request;
- Worker invocations;
- Queue events;
- cache-hit target;
- cross-D1 calls;
- R2 operations;
- expected QPS.

Normative invariant:

> Public traffic growth MUST NOT cause proportional D1 growth.

The architecture does not guarantee a permanently zero Cloudflare bill. It is designed to keep D1 from becoming linearly coupled to public traffic and to keep unnecessary synchronous work out of the hot path.

## 17. Migration / Portability Contract

Domain contracts and stable identifiers must remain portable to standard PostgreSQL/GCP-class infrastructure.

Requirements:

- versioned migrations;
- provider-neutral domain models;
- no API dependence on D1 implementation details;
- migration checksum/reconciliation;
- backward-compatible API evolution;
- controlled dual-read/dual-write only when required;
- Cloudflare-specific behavior isolated behind replaceable adapters.

## 18. Feature Reconciliation

Every feature change must reconcile:

```text
Feature <-> API
API <-> Data
API <-> Security
Data <-> Migration
Feature <-> Code
API <-> Test
Feature <-> Evidence
```

The reconciliation must detect:

- missing APIs;
- missing data fields/entities;
- missing security policies;
- missing tests;
- missing runtime ownership;
- missing evidence;
- orphan APIs;
- orphan database artifacts;
- orphan code;
- orphan tests;
- orphan events/cache entries.

A feature change is not complete until reconciliation is green.

## 19. Evidence Contract

Evidence Registry cannot pass merely because it is non-empty.

A completed capability must have verifiable evidence connecting:

```text
Feature
 -> API
 -> Data
 -> Security
 -> Implementation
 -> Test
 -> CI
 -> Deployment
 -> Smoke
```

Evidence should include Feature ID, API ID, Data ID, Security ID, Test ID, commit SHA, workflow run, deployment and smoke result where applicable.

## 20. GREEN Definition

GREEN requires all applicable gates to pass:

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

Additionally:

- no orphan API;
- no orphan DB artifact;
- no missing feature implementation;
- no missing test;
- no authorization bypass;
- no unbounded Worker chain;
- no unnecessary D1 read;
- no unnecessary D1 write.

GitHub Actions green alone does not constitute platform GREEN.

## 21. Split Gate

12 Workers / 4 D1 is the current baseline, not an arbitrary permanent limit.

A new Worker or D1 domain requires evidence of an actual boundary based on one or more of:

- ownership boundary;
- transaction boundary;
- traffic/scaling boundary;
- security boundary;
- lifecycle boundary;
- capacity evidence;
- operational benefit;
- migration benefit.

“Future may become large” alone is insufficient justification for a split.

## 22. Development Sequence

```text
Foundation:
T01 -> T02 -> T03 -> T04 -> T05

Content:
T06 -> T07 -> T08 -> T09

Community:
T10 -> T11 -> T12

Discovery:
T13 -> T14 -> T15

Commerce:
T16 -> T17 -> T18

Advanced:
T19 -> T20 -> T21

Platform:
T22 -> T23 -> T24 -> T25
```

Each Task follows:

```text
Contract
 -> Implementation
 -> Verification
 -> Evidence
 -> GREEN
 -> Next Task
```

No feature batch may bypass the GREEN gate.

## 23. Relationship to Blueprint Closure

The existing `docs/00-LUCKREAD-BLUEPRINT-CLOSURE-v3.0.md` remains the feature-completeness authority for B01-B20. This document adds the current cross-cutting platform contract and runtime/data baseline; it does not silently reopen the frozen feature inventory.

If a genuinely new product capability is discovered, it requires formal Change Control and a new Feature ID rather than informal expansion.

## 24. Contract Baseline

The platform baseline is now:

```text
B01-B20 Feature Blueprint
        -> 25 Business Contract Tasks
        -> 12 Runtime Workers
        -> 4 Physical D1 Domains
        -> API/Data/Security/Runtime/Event Contracts
        -> Reconciliation
        -> Evidence
        -> CI/Deploy/Smoke
        -> GREEN
```

This file is the cross-cutting platform Contract v1.0 baseline. Domain-specific contracts remain authoritative for their respective domains and must reconcile against this baseline.
