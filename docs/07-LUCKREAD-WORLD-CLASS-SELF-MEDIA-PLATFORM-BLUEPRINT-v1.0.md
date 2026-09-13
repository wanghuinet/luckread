# LuckRead World-Class Self-Media Platform Blueprint v1.0

**Status:** ARCHITECTURE BASELINE / READY FOR CONTRACT-FIRST IMPLEMENTATION

**Target:** Global, high-concurrency, IP-aggregation self-media community platform.

**Repository:** `wanghuinet/luckread`

## 1. Mission

LuckRead is not a simple CMS or a single-format content site. It is a unified platform for creators, IP, content, communities, distribution, interaction, rights and monetization across H5, Android and iOS.

Target capability coverage includes the major patterns of Toutiao, Douyin, Kuaishou, Weibo, Xiaohongshu, Bilibili, YouTube and TikTok, while making **IP aggregation and IP economy** a first-class platform model.

## 2. Frozen platform domains

1. Identity
2. Creator
3. Organization / MCN
4. Content
5. Content Graph
6. Media
7. Social Graph
8. Community
9. Interaction
10. Feed
11. Recommendation
12. Risk & Trust
13. Safety & Moderation
14. Copyright / Rights
15. Live / Realtime
16. Search / Discovery
17. Monetization / Commerce
18. Analytics / Experiment
19. Platform Operations
20. Open Platform / Apps
21. IP Graph / IP Economy (cross-cutting)

No new top-level domain may be introduced during implementation without Architecture Review.

## 3. IP Graph

The canonical relationship is:

```text
User
 -> Creator
 -> Creator IP
 -> Content IP
 -> Series / Universe
 -> Article / Dynamic / Video / Audio / Novel / Comic / Drama / Live
 -> Community / Fans
 -> Game / App / Commerce
 -> License / Revenue / Settlement
```

Canonical relationship types include:
`reply_to`, `quote`, `repost`, `reference`, `remix`, `clip_from`, `series_of`, `episode_of`, `collection_of`, `related_to`, `recommended_with`, `translated_from`, `localized_from`, `adapted_from`, `licensed_from`.

The platform must not make `article_id` or `video_id` the only cross-domain identity. Content must remain attachable to an IP graph.

## 4. Eight closed business loops

### 4.1 User loop

`registration -> identity -> follow -> creator -> community -> interaction -> retention`

### 4.2 Content loop

`creation -> draft -> moderation -> publish -> distribution -> recommendation -> consume -> interact -> feedback -> recreate`

### 4.3 IP loop

`creator -> IP -> content -> series/universe -> fans/community -> derivative media -> licensing/monetization -> IP value -> new creation`

### 4.4 Recommendation loop

`exposure -> consume -> interaction -> event -> risk/trust -> valid signal -> candidate -> ranking -> next exposure`

Raw events are never trusted recommendation signals without quality/risk processing.

### 4.5 Creator commercial loop

`creator -> content -> audience -> influence -> ads/membership/tips/products/licensing -> ledger -> settlement -> creator/MCN -> reinvestment -> creation`

### 4.6 Consumption loop

`discover -> feed/search/topic -> consume -> interact -> follow/save -> history/resume -> return -> personalized distribution`

### 4.7 Governance loop

`user/creator/content -> behavior -> risk -> moderation -> enforcement -> appeal -> evidence -> review -> decision -> audit -> policy improvement`

### 4.8 Data loop

`event -> queue/cache -> validation/risk -> aggregation -> analytics/recommendation/operations/commerce -> decision -> new event`

## 5. Authoritative versus derived state

### Authoritative

- identity/account status
- permissions
- creator/organization records
- content metadata and lifecycle state
- rights/licenses
- moderation decisions
- financial ledger and settlement state
- privacy/consent state
- application/release state

Authoritative state is persisted durably.

### Derived / high-volume

- views
- likes/reactions counters where safely aggregatable
- hot scores
- feed candidates
- ranking features
- unread aggregates
- trending lists
- analytics aggregates
- presence/typing

Derived state follows:

```text
Event -> Cache/Queue -> Validation/Risk -> Aggregation -> Batch -> durable state when required
```

## 6. Runtime boundary

### Payload

Payload remains upstream original. It owns CMS/admin primitives and official extension points only.

Payload must not become the business orchestration engine.

### API

Stable versioned APP-facing DTO/API boundary. It hides Payload internals and provides one contract for H5/Android/iOS.

### Workers / services

Business domains with asynchronous, high-volume, media, realtime, search, risk, recommendation, notification, analytics and operations responsibilities live outside Payload.

### D1

Authoritative structured state and transactional metadata.

### R2

Large media, content blobs, derived artifacts and evidence where appropriate.

### Cache

Hot, ephemeral and derived state only; cache is never the sole authority for critical state.

### Queue

Events, fan-out, aggregation, batch persistence, media workflows and asynchronous domain processing.

## 7. API completeness rule

Every product capability must map to a stable API contract before implementation.

Minimum API requirements:

- `/v1` versioning
- authentication and authorization
- request ID / idempotency where applicable
- standard error model
- DTO validation
- cursor pagination
- rate limiting
- CORS/security policy
- privacy and risk checks
- no Payload-internal objects exposed
- H5/Android/iOS compatibility

## 8. Safety, rights and trust are core paths

Moderation, risk, copyright and appeal are not optional post-launch add-ons.

Every user/content/interaction path must have an explicit policy boundary where applicable:

`identity -> authorization -> risk -> action -> audit`

Content and media paths additionally support:

`ownership -> rights -> moderation -> publication -> distribution -> claim/takedown -> appeal`

## 9. Commerce and settlement

All monetization features must converge on a durable ledger model.

```text
commercial event
 -> entitlement/order/revenue record
 -> ledger
 -> revenue allocation
 -> settlement
 -> audit
```

Balances and settlement state must never be inferred only from analytics events or cached counters.

## 10. High-concurrency and cost rules

The platform is designed for high concurrency without turning every request into a durable database write.

Rules:

1. Cache repeated reads.
2. Batch high-frequency writes.
3. Queue fan-out and expensive work.
4. Keep authoritative writes minimal and explicit.
5. Use R2 for large objects instead of inflating relational rows.
6. Protect every hot path with rate/risk controls.
7. Every feature requires a Cost Review.

Correctness, security and reliability always override cost optimization.

## 11. APP experience contract

H5, Android and iOS share versioned domain APIs. APP-specific behavior is isolated to presentation/runtime adapters.

Required platform capabilities include bootstrap, remote config, feature flags, experiment assignment, version policy, deep links, push/unread, offline cache, delta/read-state sync and device capability negotiation.

## 12. Operations and audit

Platform operations must cover users, creators, MCN, content, moderation, risk, copyright, search, live, commerce, revenue, developer apps and incidents.

Every sensitive administrative action requires actor, target, reason, timestamp, request/correlation ID and immutable audit evidence where required.

## 13. P0/P1/P2 implementation sequence

### P0 — platform foundation

Identity/Auth/Permission, unified content identity, content lifecycle, IP graph foundation, social graph, interaction contract, feed protocol, event/risk foundation, moderation/appeal foundation, rights foundation, API foundation, APP bootstrap, privacy/consent, operations/audit, cost/observability.

### P1 — mainstream experience

Creator Studio, MCN operations, media processing, advanced feed/recommendation, community, live, IM, search, notification fan-out, analytics, commerce, settlement, localization and richer APP synchronization.

### P2 — ecosystem scale

Open Platform, developer ecosystem, app market, advanced semantic search, advanced experimentation, creator marketplace, advanced IP licensing, cross-market expansion and other non-foundational capabilities.

P2 interfaces may be frozen early but implementation must not bypass P0 contracts.

## 14. Complete Closure Gate

The platform architecture is considered fully closed only when all are true:

- Every domain has an owner and boundary.
- Every P0 capability has a Feature Contract.
- Every P0 data entity has a Data Contract.
- Every P0 APP capability has an API Contract.
- Authoritative and derived state are explicitly classified.
- Payload/worker/runtime boundaries are explicit.
- Risk/moderation/rights/appeal paths are connected to relevant business flows.
- Monetization terminates in ledger and settlement contracts.
- Recommendation consumes only validated/trusted signals.
- H5/Android/iOS share stable API contracts.
- High-frequency paths have queue/cache/aggregation behavior defined.
- Cost Review and failure behavior exist for every P0 feature.
- Test and acceptance criteria exist before implementation.
- GitHub is the source of truth.

Until this gate passes, architecture work may continue, but broad uncontrolled business coding is not authorized.

## 15. Development admission contract

Every feature follows:

```text
Requirement
 -> Architecture Review
 -> Feature Boundary
 -> Data Contract
 -> API/DTO Contract
 -> Payload/Worker Boundary
 -> Risk/Security Review
 -> Cost Review
 -> Test/Acceptance Contract
 -> READY
 -> Implementation
 -> Local PASS
 -> CI PASS
 -> User Acceptance PASS
 -> DONE
```

The first implementation wave starts with P0 Identity and API foundations, then proceeds to Content/IP foundations. No downstream feature may invent its own identity, authorization, event, error, pagination or audit semantics.

## 16. Non-goals

- No Payload core fork.
- No copying Payload internal source into business domains.
- No business logic hidden inside uncontrolled hooks.
- No direct trust of raw high-frequency behavior.
- No analytics-derived financial authority.
- No feature-by-feature schema improvisation without contracts.
- No premature microservice decomposition without measurable boundary evidence.

## 17. Decision

**Status: APPROVED ARCHITECTURE BASELINE FOR CONTRACT-FIRST IMPLEMENTATION.**

The next development artifact is the P0 Identity/API foundation contract. Implementation begins only from that contract and its acceptance tests.