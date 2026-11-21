# FEED-001..013 Real-Evidence Reconciliation v1

**Status:** BLOCKED_NOT_GREEN
**Implementation authorization:** false
**Mapping mode:** Evidence-bound only
**Scope:** FEED-001 following; FEED-002 for-you; FEED-003 latest; FEED-004 trending/popular; FEED-005 topic/category; FEED-006 creator; FEED-007 video/live; FEED-008 guest/new-user; FEED-009 candidate recall; FEED-010 ranking/re-ranking; FEED-011 dedup/diversity/frequency; FEED-012 negative feedback; FEED-013 feed cache.

## 1. Purpose

This batch reconciles the thirteen frozen Feed/Discovery feature IDs against repository evidence available on `main`. It does not invent API operation IDs, DTO IDs, entity IDs, field IDs, persistence mappings, Payload collections, Worker implementations, security evidence, lifecycle evidence, tests, or Evidence Registry records.

A Blueprint feature or design-contract statement is not promoted to Mapping MATCH without executable or otherwise authoritative repository evidence.

## 2. Frozen feature evidence

The Blueprint and feature inventory identify FEED-001 through FEED-013. The existing B07-B09 mapping inventory marks all thirteen unresolved. Therefore this batch records evidence and closure requirements only.

## 3. Feed contract evidence

`docs/12-P0-FEED-RECOMMENDATION-TRUST-CONTRACT-v1.0.md` is authoritative design evidence for the feed trust boundary. It defines initial feed types including for-you, following, latest, trending, topic, creator, IP, video, live and related. It requires versioned cursors, request/correlation IDs, stable item identity, continuation cursors, deduplication keys and server-side visibility filtering. It defines the candidate pipeline as Sources → Eligibility → Safety/Privacy → Candidate Recall → Trust Weighting → Ranking → Diversity/Frequency Cap → Final Feed. It also defines feedback signals, cold-start/diversity requirements, poisoning controls, rebuildability and the cost rule that exposure/behavior events should prefer cache/queue/aggregation paths over unconditional D1 writes.

The contract defines public feed boundaries `GET /v1/feed/:feedType`, `POST /v1/feed/events`, `POST /v1/feed/feedback`, and `GET /v1/recommendations/:surface`, but these are contract evidence only. They are not yet complete endpoint-level Mapping 0 evidence.

## 4. API inventory reconciliation

`contracts/api/api-inventory.v1.json` independently inventories feed endpoints `GET /v1/feed`, `GET /v1/feed/following`, `GET /v1/feed/recommended`, `GET /v1/feed/user/{userId}`, and `GET /v1/content/{contentId}/related`. It also inventories recommendation feedback/context endpoints under the recommendation_realtime domain.

The API inventory explicitly requires schema, OpenAPI operation ID, permission, scope, state machine where applicable, cache policy, read/write classification, resource budget, RPC/retry/event/queue budgets, anti-abuse, idempotency, mapping, examples and integration/security E2E evidence. It states that an endpoint cannot be Contract Green until all required evidence dimensions are explicitly mapped and validated.

This creates a real cross-document reconciliation requirement: the feed trust contract uses parameterized `/v1/feed/:feedType` and `/v1/feed/events`, while the API inventory uses several concrete feed paths. No operation is promoted to MATCH until a canonical API surface and operation IDs are established in repository evidence.

## 5. Feature-by-feature reconciliation

### FEED-001 — following feed

**Status:** BLOCKED_NOT_GREEN

**Evidence:** following is a frozen feed type in the Feed Recommendation Trust Contract; `/v1/feed/following` exists in API Inventory; the capability recovery corpus contains following-listing material.

**Not evidence-bound:** canonical capability ID; request/response DTO IDs; concrete handler implementation; authoritative follow-graph query/projection; D1 read authority; cache key/version semantics; blocked/private filtering implementation; pagination execution; integration/security E2E; Evidence Registry provenance.

### FEED-002 — for-you feed

**Status:** BLOCKED_NOT_GREEN

**Evidence:** for-you is a frozen feed type and participates in the candidate pipeline.

**Not evidence-bound:** canonical API operation ID; DTOs; candidate source registry; recall implementation; ranking contract implementation; trust/safety feature authority; cold-start implementation; cache/projection; runtime/tests/evidence.

### FEED-003 — latest feed

**Status:** BLOCKED_NOT_GREEN

**Evidence:** latest is a frozen feed type. API inventory contains general feed endpoints, but no repository evidence currently resolves the exact canonical latest-feed operation ID and its source-of-truth semantics.

**Not evidence-bound:** canonical latest endpoint/operation; stable ordering authority under concurrent inserts; DTO; persistence/query contract; cache policy; implementation; tests/evidence.

### FEED-004 — trending/popular feed

**Status:** BLOCKED_NOT_GREEN

**Evidence:** trending is a frozen feed type in the trust contract and appears in UX contract evidence.

**Not evidence-bound:** canonical ranking/aggregation source; freshness window; anti-manipulation policy implementation; DTO/API; derived-state authority; cache; runtime/tests/evidence.

### FEED-005 — topic/category feed

**Status:** BLOCKED_NOT_GREEN

**Evidence:** topic is a frozen feed type.

**Not evidence-bound:** canonical taxonomy entity/field IDs; topic-to-content relation; API/DTO; filtering/projection authority; authorization and visibility implementation; cache; tests/evidence.

### FEED-006 — creator feed

**Status:** BLOCKED_NOT_GREEN

**Evidence:** creator is a frozen feed type and the feature inventory identifies FEED-006 as creator feed.

**Not evidence-bound:** creator ownership/canonical creator entity mapping; API/DTO; content eligibility; pagination; authorization; projection/cache; runtime/tests/evidence.

### FEED-007 — video/live feed

**Status:** BLOCKED_NOT_GREEN

**Evidence:** video and live are frozen feed types in the trust contract.

**Not evidence-bound:** media eligibility authority; live session state integration; media/content relation; API/DTO; rights/visibility filtering; delivery projection/cache; runtime/tests/evidence.

### FEED-008 — guest/new-user feed

**Status:** BLOCKED_NOT_GREEN

**Evidence:** trust contract explicitly requires new-user cold start and risk-aware exploration.

**Not evidence-bound:** guest identity policy; cold-start candidate source; safety eligibility; personalization boundary; API/DTO; anti-abuse implementation; runtime/security E2E.

### FEED-009 — candidate recall

**Status:** BLOCKED_NOT_GREEN

**Evidence:** candidate recall is an explicit stage of the frozen pipeline.

**Not evidence-bound:** canonical candidate-source registry; interface/DTO; source ownership; eligibility contract implementation; bounded fanout/resource budget; ranking input schema; failure/retry behavior; tests/evidence.

### FEED-010 — ranking/re-ranking

**Status:** BLOCKED_NOT_GREEN

**Evidence:** ranking is an explicit pipeline stage, while the contract intentionally does not select a specific ranking algorithm.

**Not evidence-bound:** canonical ranking interface; feature schema; trust-weight authority; ranking version; safety/authorization constraints; re-ranking contract; deterministic fallback; implementation/tests/evidence.

### FEED-011 — dedup/diversity/frequency control

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the trust contract requires deduplication, diversity and frequency caps and defines a deduplication key.

**Not evidence-bound:** canonical state/field model; scope of deduplication; frequency-window authority; diversity policy implementation; cache/projection; concurrency behavior; tests/evidence.

### FEED-012 — negative feedback/hide/not-interested

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the trust contract lists not-interested and hide among supported feedback signals and requires validated raw signals.

**Not evidence-bound:** canonical interaction/feedback API; DTO/entity; suppression authority; persistence; event versioning; abuse controls; propagation/invalidation; tests/evidence.

### FEED-013 — feed cache

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the trust contract requires cache/derived-view preference when freshness permits and says derived feed state must be rebuildable where practical.

**Not evidence-bound:** cache key/version contract; authoritative versus derived boundary; invalidation/version propagation; TTL/freshness contract; public/private isolation; implementation; failure/rebuild tests; Evidence Registry.

## 6. Cross-feature invariants

1. Feed delivery must filter private, blocked and removed content before exposure.
2. Client code must not depend on database offset pagination.
3. Cursor semantics must remain stable under concurrent inserts.
4. Derived feed state is never authoritative content state.
5. Ranking implementation details must not leak through public DTOs.
6. Raw behavior cannot bypass trust/risk validation.
7. Recommendation poisoning controls must cover automated traffic, coordinated engagement, spam, fraud and abnormal behavior.
8. Guest/new-user handling must not require privileged user state that does not exist.
9. Cache entries must respect visibility and scope boundaries.
10. Feed projections must be rebuildable from authoritative state/events where the contract requires rebuildability.

## 7. Required closure chain

Each FEED feature requires:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

At minimum, closure requires canonical API/DTO IDs, candidate/source authority, persistence or derived-state authority, permission/scope, visibility and safety filtering, cursor/pagination semantics, resource/retry/idempotency budgets where applicable, cache/projection rules, executable implementation, positive/negative/concurrency/security tests, and Evidence Registry provenance with validating commit SHA.

## 8. Admission decision

All FEED-001..013 remain `BLOCKED_NOT_GREEN`. No implementation authorization is granted by this batch.

The repository already contains meaningful feed architecture and API inventory evidence, but the documents are not yet reconciled into a complete executable mapping. The correct next step is to close canonical API/DTO/capability references and then entity/persistence/projection evidence rather than inventing IDs or implementation details.
