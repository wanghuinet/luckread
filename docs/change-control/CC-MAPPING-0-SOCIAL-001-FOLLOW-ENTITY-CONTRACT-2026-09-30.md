# CC-MAPPING-0-SOCIAL-001-FOLLOW-ENTITY-CONTRACT-2026-09-30

**Status:** CONTRACT-FIRST / ADMITTED / VERIFICATION-PENDING
**Scope:** `SOCIAL-001` Follow/Unfollow authoritative relation
**Repository authority:** GitHub `main`
**Implementation authorization:** false

## Decision

通过 Contract-First Change Control 正式建立 Social Follow 的逻辑实体标识：

`ENT-SOCIAL-FOLLOW` — `SocialFollowRelationship`

该实体服务于：

- `SOCIAL-001` follow / unfollow；
- `SOCIAL-002` followers / following 的权威关系读取。

它属于已经冻结的 Social Graph 所有权边：

```text
SOCIAL → T11 → W05 → D1-02
```

本变更只建立合同级 Entity / Field authority，不声明已经存在的物理表、Migration、Payload Collection、W05 runtime 或 Evidence Registry VERIFIED 记录。

## Canonical Contract Fields

| Field | Canonical Field ID | Semantics |
|---|---|---|
| relationshipId | `ENT-SOCIAL-FOLLOW-F-RELATIONSHIP-ID` | 关系实例唯一标识；不可复用 |
| followerUserId | `ENT-SOCIAL-FOLLOW-F-FOLLOWER-USER-ID` | 发起 Follow 的 User |
| targetUserId | `ENT-SOCIAL-FOLLOW-F-TARGET-USER-ID` | 被 Follow 的 User |
| createdAt | `ENT-SOCIAL-FOLLOW-F-CREATED-AT` | 权威关系创建时间 |

## Authority Rules

1. Authenticated actor identity MUST come from the server-side principal; client input MUST NOT be treated as authoritative follower identity.
2. `followerUserId` and `targetUserId` MUST reference authoritative `ENT-USER` identities in the Identity/User authority domain.
3. At most one active Follow relation may exist for the tuple `(followerUserId, targetUserId)`.
4. `relationshipId` is immutable and MUST NOT be reused after an authoritative relation is removed.
5. Follow creation and Unfollow removal are atomic relation mutations; a missing relation on Unfollow is an idempotent success.
6. Target eligibility, account state, block policy, privacy and scope are evaluated by the canonical operation/security contracts before the authoritative write.
7. Follower/following counts are derived projections and MUST NOT become fields on this entity.
8. Idempotency keys, event envelopes, cache state, risk scores and analytics aggregates are not authoritative Entity fields.
9. No Payload-native Collection is claimed by this contract. The logical entity is owned by Social/W05/D1-02; concrete persistence remains a separate Contract-First step.
10. The entity is intentionally portable to PostgreSQL-compatible persistence; no D1-specific schema shape is frozen here.

## Explicit Non-Goals

- No W05 handler implementation.
- No D1 table creation or migration.
- No Payload Collection creation.
- No event producer implementation.
- No cache/projection implementation.
- No runtime or security E2E evidence.
- No Evidence Registry promotion.
- No Mapping 0 GREEN promotion.

## Required Next Steps

```text
Entity contract
→ Entity/Field registry reconciliation
→ Social DTO contract
→ persistence contract
→ W05 physical binding evidence
→ implementation admission
→ runtime/security/concurrency tests
→ Evidence Registry
→ feature Mapping promotion
```

This Change Control establishes the missing Entity/Field contract identifiers without claiming technical verification.


## DTO Contract Reconciliation

The canonical DTO edge for the promoted Social Follow mutation operations is now established in `contracts/dto/auth-dto-contract.v1.json`:

- `follow` → `DTO-SOCIAL-FOLLOW-REQUEST` → `#/paths/~1social~1follows/post/requestBody/content/application~1json/schema`;
- `unfollow` → `DTO-SOCIAL-UNFOLLOW-REQUEST` → `#/paths/~1social~1follows/delete/requestBody/content/application~1json/schema`;
- both operations retain their existing no-body success semantics: 200 for follow and 204 for unfollow.

This reconciliation adds no runtime, persistence, Payload, security-E2E, concurrency, event, cache, or Evidence Registry claim. `SOCIAL-002` followers/following discovery operations remain unpromoted and are not assigned DTOs.
