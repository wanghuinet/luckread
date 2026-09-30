# SOCIAL-001..010 Real-Evidence Reconciliation v1

**Status:** BLOCKED_NOT_GREEN
**Implementation authorization:** false
**Mapping mode:** Evidence-bound only
**Scope:** SOCIAL-001 follow/unfollow; SOCIAL-002 followers/following; SOCIAL-003 like/reaction; SOCIAL-004 comment/reply; SOCIAL-005 favorite/bookmark; SOCIAL-006 share/repost/quote; SOCIAL-007 mention/hashtag; SOCIAL-008 poll/vote; SOCIAL-009 block/mute/hide; SOCIAL-010 relationship graph.

## 1. Purpose

This batch reconciles the ten frozen Social graph and interaction feature IDs against repository evidence available on `main`. It does not invent API operation IDs, DTO IDs, entity IDs, field IDs, persistence mappings, Payload collections, Worker implementations, security evidence, lifecycle evidence, tests, or Evidence Registry records.

## 2. Frozen feature evidence

The Blueprint freezes the social graph and interaction surface at `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md:L192-L201`. The existing B10-B12 mapping inventory marks all ten unresolved. This batch records evidence and closure requirements only.

## 3. Social contract evidence

`docs/11-P0-SOCIAL-INTERACTION-AND-EVENT-CONTRACT-v1.0.md` freezes follow, block, mute, privacy, like, favorite, share, comment, reply, mention, and high-frequency event semantics. It distinguishes authoritative interactions (comment/reply, favorite, follow, block, report) from high-frequency interactions (view, like/reaction where volume requires aggregation, share, dwell/watch progress, feed exposure), and requires aggregation to preserve idempotency/event identity where correctness requires it. It defines a canonical event envelope with `eventId`, `eventType`, `eventVersion`, `actorId`, target type/id, timestamp, correlation/request ID, and source/client version.

`docs/54-SOCIAL-COMMUNITY-SYSTEM-CONTRACT-v1.0.md` places Social/Community as the owner of user relationship, interaction relationship, and community space, and states that counters, ranking signals, and activity aggregates are derived data, not authoritative writes. High-frequency behavior is not a mandatory per-event authoritative business write path.

`contracts/api/interaction-operation-policy.v1.json` and `contracts/api/block-mute.v1.json` are real API contract evidence. `block-mute.v1.json` explicitly requires actor identity to come from the server-side principal, targets to be resolved server-side, and block to take precedence over follow, like, comment, message, feed, search, and notification visibility. Mute must not imply block.

## 4. API inventory reconciliation

`contracts/api/api-inventory.v1.json` inventories the interaction domain with concrete paths including `POST/DELETE /v1/social/follows`, `POST/DELETE /v1/users/{userId}/follow`, `POST/DELETE /v1/comments/{commentId}/likes`, `POST/DELETE /v1/content/{contentId}/likes`, `POST/DELETE /v1/content/{contentId}/favorites`, `POST/DELETE /v1/interactions/blocks`, `POST/DELETE /v1/interactions/mutes`, `POST/DELETE /v1/interactions/likes`, and comment CRUD under `/v1/comments` and `/v1/content/{contentId}/comments`.

These are inventory evidence only. No operation is promoted to MATCH until a canonical OpenAPI operation ID, DTO, entity, permission/scope, and executable handler are established in repository evidence. Mentions/hashtags are partially covered by taxonomy contracts (`docs/100..107-TAXONOMY-*`) rather than a single interaction contract; poll/vote has no dedicated contract evidence yet.

## 5. Feature-by-feature reconciliation

### SOCIAL-001 — follow/unfollow

**Status:** BLOCKED_NOT_GREEN

**Evidence:** follow is an authoritative relation in the P0 social interaction contract; `/v1/social/follows` and `/v1/users/{userId}/follow` exist in the API inventory.

**Not evidence-bound:** canonical follow-graph entity/field; OpenAPI operation ID; DTO; permission `social.follow`/scope; idempotency/concurrency constraint; event `follow.created`/`follow.deleted`; cache invalidation; D1 authority; runtime/tests/Evidence Registry provenance.

### SOCIAL-002 — followers/following

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the social/community system contract states follower counts are derived state, while follow is authoritative.

**Not evidence-bound:** canonical count/aggregate source; rebuildability contract; projection/cache authority; API/DTO; consistency window; concurrency under follow/unfollow; runtime/tests/evidence.

### SOCIAL-003 — like/reaction

**Status:** BLOCKED_NOT_GREEN

**Evidence:** like/reaction is a frozen high-frequency interaction in the P0 contract; like endpoints exist in the API inventory (`/v1/content/{contentId}/likes`, `/v1/interactions/likes`, `/v1/comments/{commentId}/likes`).

**Not evidence-bound:** canonical reaction entity/field; aggregate versus authoritative write boundary; idempotency/event identity; DTO/operation ID; anti-abuse; rate limits; event `reaction.created/deleted`; projection/cache; runtime/tests/evidence.

### SOCIAL-004 — comment/reply

**Status:** BLOCKED_NOT_GREEN

**Evidence:** comment/reply is a frozen authoritative interaction; comment CRUD appears in the API inventory.

**Not evidence-bound:** canonical comment/reply entity and tree/pagination model; DTO; moderation/report boundary; permission; content-availability handling; idempotency; event `comment.created/deleted`; persistence; runtime/security E2E; Evidence Registry.

### SOCIAL-005 — favorite/bookmark

**Status:** BLOCKED_NOT_GREEN

**Evidence:** favorite is a frozen authoritative interaction in the P0 contract; favorite endpoints exist in the API inventory.

**Not evidence-bound:** canonical favorite entity/field; operation ID; DTO; permission; idempotency; event `favorite.changed`; persistence; projection; runtime/tests/evidence.

### SOCIAL-006 — share/repost/quote

**Status:** BLOCKED_NOT_GREEN

**Evidence:** share is a frozen high-frequency interaction; share/quote surfaces appear in the API inventory (`/v1/shares`, `/v1/content/{contentId}/shares`).

**Not evidence-bound:** canonical share/quote entity; provenance and trace target authority; DTO; permission; event `share.created`; aggregation semantics; anti-abuse; persistence; runtime/tests/evidence.

### SOCIAL-007 — mention/hashtag

**Status:** BLOCKED_NOT_GREEN

**Evidence:** mention is frozen in the P0 interaction contract; hashtag/topic is governed by the taxonomy contracts and `100-TAXONOMY-TOPIC-HASHTAG-AND-ENTITY-SYSTEM-CONTRACT-v1.0.md`.

**Not evidence-bound:** canonical mention/hashtag resolution entity; taxonomy-to-content relation; DTO/operation; notification trigger authority; aggregation; permission; runtime/tests/evidence.

### SOCIAL-008 — poll/vote

**Status:** BLOCKED_NOT_GREEN

**Evidence:** poll/vote is frozen in the Blueprint but has no dedicated contract document or API inventory entry.

**Not evidence-bound:** canonical poll entity/field; vote deduplication/uniqueness; DTO/operation; permission/scope; anti-abuse; event; persistence; runtime/tests/evidence.

### SOCIAL-009 — block/mute/hide

**Status:** BLOCKED_NOT_GREEN

**Evidence:** `contracts/api/block-mute.v1.json` is real contract evidence requiring server-side actor identity, block precedence over all distribution surfaces, mute-not-implied-block semantics, cache invalidate/version-bump, and bounded async events. Block/mute endpoints exist in the API inventory.

**Not evidence-bound:** canonical block/mute/hide relationship entity; operation IDs (`blockUser`, `muteUser`, etc.) bound to executable handlers; DTO; permission/scope; anti-abuse; concurrency constraint implementation; event emission; runtime/security E2E; Evidence Registry.

### SOCIAL-010 — relationship graph

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the P0 social interaction contract defines follow, mutual-follow derived state, block, mute, and close-friend/private audience membership as the core social graph.

**Not evidence-bound:** canonical graph entity/field authority; mutual-follow derivation authority; query/traversal projection; DTO/API; permission; cache/rebuildability; persistence; runtime/tests/evidence.

## 6. Cross-feature invariants

1. Block takes precedence over follow, like, comment, feed, search, message, and notification visibility.
2. Mute must not delete authoritative content or relationships.
3. Follower/like/comment counts are derived state and must be rebuildable, never authoritative writes.
4. Client-supplied identity, counters, and relationship state are never trusted.
5. High-frequency interactions may aggregate, but idempotency/event identity must be preserved where correctness requires it.
6. Privacy/audience policy is evaluated server-side.
7. Private content must not leak through derived caches.
8. All social graph mutations conform to account-state, anti-abuse, and tenant/scope checks before the authoritative write.
9. Events are delivered at-least-once and consumers must be idempotent.

## 7. Required closure chain

Each SOCIAL feature requires:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

At minimum, closure requires canonical API/DTO IDs, authoritative relation or aggregate authority, permission/scope, visibility and safety filtering, idempotency/concurrency semantics, event identity and delivery guarantees, cache/projection rules, executable implementation, positive/negative/concurrency/security tests, and Evidence Registry provenance with validating commit SHA.

## 8. Admission decision

All SOCIAL-001..010 remain `BLOCKED_NOT_GREEN`. No implementation authorization is granted by this batch.

The repository contains meaningful social interaction, contract, and API inventory evidence, but the documents are not reconciled into a complete executable mapping. The correct next step is to establish canonical API/entity/DTO references for the social graph and interaction surfaces, then close persistence/projection and runtime evidence rather than inventing IDs or implementation details.