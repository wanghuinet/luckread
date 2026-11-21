# COMMUNITY-001..008 Real-Evidence Reconciliation v1

**Status:** BLOCKED_NOT_GREEN
**Implementation authorization:** false
**Mapping mode:** Evidence-bound only
**Scope:** COMMUNITY-001 community/channel; COMMUNITY-002 group/thread; COMMUNITY-003 community rules; COMMUNITY-004 moderator roles; COMMUNITY-005 member levels/badges; COMMUNITY-006 community moderation; COMMUNITY-007 slow mode/rate controls; COMMUNITY-008 community events.

## 1. Purpose

This batch reconciles the eight frozen Community feature IDs against repository evidence available on `main`. It does not invent API operation IDs, DTO IDs, entity IDs, field IDs, persistence mappings, Payload collections, Worker implementations, moderation evidence, or Evidence Registry records.

## 2. Frozen feature evidence

The Blueprint freezes Community at `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md:L205-L212`. The existing B10-B12 mapping inventory marks all eight unresolved. This batch records evidence and closure requirements only.

## 3. Community contract evidence

`docs/54-SOCIAL-COMMUNITY-SYSTEM-CONTRACT-v1.0.md` defines the community model as `Community → Membership → Role → Topic/Content → Moderation`, and lists community/group, topic, moderator, membership, roles, and moderation responsibilities. It requires `/v1/community` with cursor pagination, idempotency, requestId, permission checks, stable errors, rate limits, and moderation/report/appeal boundaries.

`docs/147-COMMUNITY-CENTER-EXPERIENCE-CONTRACT-v1.0.md` is design evidence for the community center experience but is not an executable API/entity mapping. `docs/188-L5-L6-SOCIAL-COMMUNITY-INTERACTION-INSTANCE-REGISTRY-v1.0.md` is an instance registry and not runtime evidence. `docs/63-MODERATION-APPEALS-SYSTEM-CONTRACT-v1.0.md` and `docs/150-MODERATION-GOVERNANCE-CENTER-EXPERIENCE-CONTRACT-v1.0.md` inform community moderation, but the community moderation feature has not been reconciled to a canonical entity/API operating surface.

## 4. API inventory reconciliation

`contracts/api/api-inventory.v1.json` does not contain a dedicated community endpoint group. Related surfaces are limited to `GET /v1/admin/moderation` and `POST /v1/reports` under other domains. There is no canonical `/v1/community` group, no community/channel entity, and no moderator/member-role operation inventory. This is a real gap: community features have contract prose but no API inventory reconciliation.

## 5. Feature-by-feature reconciliation

### COMMUNITY-001 — community/channel

**Status:** BLOCKED_NOT_GREEN

**Evidence:** community is a core model in the social/community system contract; the community center experience contract describes the channel surface.

**Not evidence-bound:** canonical community/channel entity/field; API operation ID; DTO; ownership and visibility; permission; persistence; runtime/tests/Evidence Registry.

### COMMUNITY-002 — group/thread

**Status:** BLOCKED_NOT_GREEN

**Evidence:** group/thread is listed in the social/community system contract and the community center experience contract.

**Not evidence-bound:** canonical group/thread entity and hierarchy; membership relation; DTO/API; moderation boundary; permission; persistence; runtime/tests/evidence.

### COMMUNITY-003 — community rules

**Status:** BLOCKED_NOT_GREEN

**Evidence:** community rules are referenced by the community model and the moderation governance center experience contract.

**Not evidence-bound:** canonical rules entity/versioning; enforcement boundary; DTO/API; permission; audit; runtime/tests/evidence.

### COMMUNITY-004 — moderator roles

**Status:** BLOCKED_NOT_GREEN

**Evidence:** moderator is a community model element in the social/community system contract; the RBAC permission contract (`docs/04-P0-PERMISSION-RBAC-CONTRACT-v1.0.md`) governs role/permission architecture.

**Not evidence-bound:** canonical moderator role/entitlement mapping; scoped authority; DTO/API; privilege escalation controls; audit; runtime/security E2E; Evidence Registry.

### COMMUNITY-005 — member levels/badges

**Status:** BLOCKED_NOT_GREEN

**Evidence:** membership and member levels are listed in the social/community system contract and the membership system contracts (`docs/108..115-MEMBERSHIP-*`).

**Not evidence-bound:** canonical level/badge entity; entitlement authority; DTO/API; derived versus authoritative boundary; permission; runtime/tests/evidence.

### COMMUNITY-006 — community moderation

**Status:** BLOCKED_NOT_GREEN

**Evidence:** moderation is a community model element; moderation/appeals and moderation governance contracts exist (`docs/63`, `docs/150`), and `POST /v1/reports` appears in the API inventory.

**Not evidence-bound:** canonical moderation queue/action entity; appeal boundary; DTO/operation; authorized-scope enforcement; audit; persistence; runtime/security E2E; Evidence Registry.

### COMMUNITY-007 — slow mode/rate controls

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the social/community system contract requires rate limits; the rate-limit contract (`docs/170-RATE-LIMIT-QUOTA-TRAFFIC-SHAPING-CONTRACT-v1.0.md`) governs traffic shaping.

**Not evidence-bound:** canonical slow-mode policy entity; scope (community/thread/member); DTO/API; enforcement implementation; cache/state; runtime/tests/evidence.

### COMMUNITY-008 — community events

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the social/community system contract lists `community.member.changed`, `membership.changed`, and related events; event semantics are governed by `docs/163-EVENT-SEMANTICS-DELIVERY-ORDERING-REPLAY-DLQ-CONTRACT-v1.0.md`.

**Not evidence-bound:** canonical community event schema/versioning; delivery/ordering guarantees; consumer idempotency; persistence; runtime/tests/evidence.

## 6. Cross-feature invariants

1. Community moderators can only access the authorization scope configured for their role.
2. Community rules enforcement must be auditable and versioned.
3. Member levels/badges are derived-from or bound-to authoritative membership entitlement, never a client-trusted field.
4. Slow-mode/rate controls must be enforceable server-side and must not depend on client-supplied pacing.
5. Community moderation must preserve report/appeal boundaries.
6. Community events are delivered at-least-once and consumers must be idempotent.

## 7. Required closure chain

Each COMMUNITY feature requires:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

At minimum, closure requires canonical API/DTO IDs, community/group/membership/role entity authority, permission/scope and moderation boundary, rate/abuse controls, event identity and delivery guarantees, executable implementation, positive/negative/concurrency/security tests, and Evidence Registry provenance with validating commit SHA.

## 8. Admission decision

All COMMUNITY-001..008 remain `BLOCKED_NOT_GREEN`. No implementation authorization is granted by this batch.

Community features currently have contract prose and design evidence but no canonical API inventory group, no entity/field authority, and no executable mapping. The correct next step is to establish a canonical `/v1/community` API inventory and community entity/role/membership authority before any persistence or runtime claims.