# CC-MAPPING-0-SOCIAL-002-FOLLOWER-FOLLOWING-READ-CONTRACT-2026-10-01

## Status

- Status: **CONTRACTED_PARTIAL / IMPLEMENTATION_NOT_AUTHORIZED**
- Feature: SOCIAL-002
- Scope: GET /v1/users/{userId}/followers and GET /v1/users/{userId}/following
- Worker/D1 topology change: **none**
- Runtime implementation authorization: **false**

## Authority Reconciliation

The existing Follow entity/persistence contracts already bind SOCIAL-002 to ENT-SOCIAL-FOLLOW and the existing D1-02 authoritative relation table. This Change Control adds only the missing read-side contract surface:

- canonical bounded read operation policy;
- canonical response DTO identities;
- stable opaque-cursor pagination;
- maximum page size of 50;
- one authoritative D1-02 read per request;
- relationship-visibility and block/mute checks as mandatory security gates.

No new relationship table, projection table, Worker, or D1 is introduced.

## Canonical API / DTO

| Operation | Method / Path | Response DTO | Status |
|---|---|---|---|
| getUsersUserIdFollowers | GET /v1/users/{userId}/followers | DTO-SOCIAL-FOLLOWERS-LIST-RESPONSE | CONTRACTED_PARTIAL |
| getUsersUserIdFollowing | GET /v1/users/{userId}/following | DTO-SOCIAL-FOLLOWING-LIST-RESPONSE | CONTRACTED_PARTIAL |

The response contains only userId and relation createdAt plus nextCursor, hasMore, and requestId. Internal relation identifiers are cursor material only and are not exposed.

## Persistence Binding

Both operations read the already contracted social_follow_relationships authority in D1-02:

- followers: filter target_user_id = subject user;
- following: filter follower_user_id = subject user;
- both use the existing target_user_id/created_at or follower_user_id/created_at index;
- stable tie-breaker: relationship_id DESC.

No migration is required for SOCIAL-002 read queries.

## Blocking Conditions Before Runtime

Implementation remains blocked until the following are explicitly admitted:

1. relationship-visibility authority and block/mute policy source;
2. one bounded W05 runtime query path with server-derived subject scope;
3. negative security tests for hidden/block/mute cases;
4. pagination/concurrency tests showing stable cursor behavior;
5. remote D1-02 runtime evidence;
6. Evidence Registry entry anchored to the validating commit SHA.

This record does not promote SOCIAL-002 to GREEN and does not authorize a public runtime.

## Topology

Public API (W01) → W05 Social read boundary → D1-02 social_follow_relationships

No additional Worker, D1, synchronous fan-out, or projection table is permitted by this slice.