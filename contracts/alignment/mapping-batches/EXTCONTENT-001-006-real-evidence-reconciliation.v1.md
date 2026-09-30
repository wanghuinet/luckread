# EXTCONTENT-001..006 Real-Evidence Reconciliation v1

**Status:** BLOCKED_NOT_GREEN
**Implementation authorization:** false
**Mapping mode:** Evidence-bound only
**Scope:** EXTCONTENT-001 novel; EXTCONTENT-002 comic; EXTCONTENT-003 drama/mini-drama; EXTCONTENT-004 course; EXTCONTENT-005 ebook; EXTCONTENT-006 game/game-community

## 1. Purpose

This batch reconciles the six future-content features against the repository as it exists on the current `main` snapshot. It does not invent API IDs, DTO IDs, entity IDs, field mappings, Payload collections, D1 tables, R2 keys, Worker implementations, security controls, lifecycle handlers, tests, or Evidence Registry records.

A feature is not promoted to MATCH merely because the Blueprint or a design contract names it.

## 2. Frozen feature evidence

The Blueprint and feature inventory identify all six features:

- EXTCONTENT-001 — novel
- EXTCONTENT-002 — comic
- EXTCONTENT-003 — drama/mini-drama
- EXTCONTENT-004 — course
- EXTCONTENT-005 — ebook
- EXTCONTENT-006 — game/game-community

The B07-B09 mapping inventory currently marks all six `UNRESOLVED`. This batch therefore records closure requirements rather than pretending that future-content support already exists.

## 3. Unified content identity evidence

`docs/10-P0-CONTENT-AND-IP-GRAPH-CONTRACT-v1.0.md` is real repository evidence for a unified content foundation. It defines stable content identity using immutable `id`, `contentType`, `ownerUserId`, optional `creatorId`, optional `ipId`, lifecycle `status`, visibility, canonical version and timestamps. It explicitly includes novel, comic and drama among initial extensible content types and states that the foundation is intended to support articles, dynamics, galleries, video, audio, novels, comics, drama, live, games and apps.

The same contract defines explicit lifecycle transitions, immutable published versions, R2 for large body/media payloads with D1 authoritative for metadata/references, typed IP relationships, ownership/permission constraints, versioned `/v1/content` APIs, Payload as CMS administration boundary, application-owned domain semantics, and Worker-owned asynchronous processing.

These are contract constraints. They do not constitute runtime implementation or complete Mapping 0 evidence for the six feature IDs.

## 4. Content API policy evidence

`contracts/api/content-operation-policy.v1.json` is real API-policy evidence. It explicitly states that public content APIs must not be inferred from Payload CRUD. It currently inventories content models including `article`, `post`, `video_metadata`, `gallery`, `live_metadata`, and `series`, plus lifecycle states and operations such as `listContents`, `createContent`, `getContent`, `updateContent`, `deleteContent`, `transitionContentState`, review submission, scheduling and version history.

The policy is `CONTRACTED_PARTIAL`/`MISSING` for multiple evidence dimensions. It does not currently provide six feature-specific operation IDs or complete DTO/entity/persistence/runtime evidence for novel, comic, drama, course, ebook, or game/game-community.

## 5. Feature-by-feature reconciliation

### EXTCONTENT-001 — novel

**Status:** BLOCKED_NOT_GREEN

**Evidence:** unified content contract names `novel` as an initial content type.

**Not evidence-bound:** feature-specific API/DTO contract; canonical novel entity/fields; D1 persistence/table/column authority; R2 body/reference contract; Payload collection boundary; ownership/creator/organization/entitlement rules; novel lifecycle beyond the shared state machine; versioning and chapter/volume semantics; delivery/projection; executable implementation; positive/negative/concurrency/security tests; Evidence Registry provenance.

**Required closure:** map the novel feature to the shared Content Identity contract without creating a second content identity model; separately contract any novel-specific chapter/volume/serialization requirements before implementation.

### EXTCONTENT-002 — comic

**Status:** BLOCKED_NOT_GREEN

**Evidence:** unified content contract names `comic` as an initial content type and supports large media payloads through the R2/D1 boundary.

**Not evidence-bound:** feature-specific API/DTO; canonical comic entity/fields; page/panel/image ordering model; D1 persistence; R2 object/reference rules; Payload boundary; rights/ownership/entitlement; processing/projection; lifecycle/version semantics; executable implementation; tests; Evidence Registry provenance.

**Required closure:** bind comic to shared Content Identity and separately define page/episode/volume media relationships and ordering as evidence-backed contracts.

### EXTCONTENT-003 — drama/mini-drama

**Status:** BLOCKED_NOT_GREEN

**Evidence:** unified content contract names `drama` as an initial content type and provides typed Content/IP relationships and explicit lifecycle rules.

**Not evidence-bound:** drama/mini-drama API/DTO; canonical entity/fields; series/episode relationship authority; D1 persistence; R2 media/reference model; Payload boundary; rights/territory/entitlement enforcement; publication/version rules; processing/projection; executable implementation; tests; Evidence Registry provenance.

**Required closure:** reuse unified Content Identity and contract series/episode relations before introducing any drama-specific runtime implementation.

### EXTCONTENT-004 — course

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the feature is present in the frozen Blueprint inventory; the unified content contract establishes extensible content identity and lifecycle.

**Not evidence-bound:** course-specific API/DTO; canonical course/lesson/module entity and fields; enrollment/entitlement authority; D1 persistence; R2 lesson/media references; Payload boundary; progress/completion semantics; access-control enforcement; lifecycle/versioning; executable implementation; tests; Evidence Registry provenance.

**Required closure:** first define whether course access is content visibility, entitlement, subscription, or a combination under the existing authorization model; then bind course-specific structures to the shared Content Identity.

### EXTCONTENT-005 — ebook

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the feature is present in the frozen Blueprint inventory; the unified content contract supports extensible content identity, versioning and R2-backed large payloads.

**Not evidence-bound:** ebook API/DTO; canonical ebook entity/fields; chapter/section model; D1 metadata/reference authority; R2 object/key/reference contract; download/reading entitlement; DRM/watermark policy; version/lifecycle; executable implementation; tests; Evidence Registry provenance.

**Required closure:** establish authoritative ebook metadata/version/reference semantics and entitlement/rights enforcement before implementation admission.

### EXTCONTENT-006 — game/game-community

**Status:** BLOCKED_NOT_GREEN

**Evidence:** the unified content contract names `game-reference` as an initial content type and explicitly includes games in the durable foundation goal. It also defines Content/IP relationships and an application/Worker boundary for domain and asynchronous processing.

**Not evidence-bound:** game/game-community API/DTO; canonical entity/fields; game reference versus game-service ownership boundary; community ownership/moderation model; D1 persistence; R2 assets/references; entitlement/organization scope; lifecycle; executable implementation; tests; Evidence Registry provenance.

**Required closure:** separate game reference/content from any future external game-service runtime; bind only the documented content/community surface to the shared Content Identity and authorization model.

## 6. Cross-feature invariants

The following must hold for all six features:

1. No second content identity model may be introduced.
2. `contentType` must remain explicit and allowlisted.
3. Owner/creator/IP references are server-authoritative.
4. Public DTOs must not expose Payload internals.
5. Lifecycle transitions are explicit and auditable.
6. Published versions are reproducible and do not mutate implicitly through draft edits.
7. Large body/media payloads may use R2, while D1 remains authoritative for metadata/references.
8. Entitlement and rights checks cannot be bypassed by a Payload CRUD path.
9. Derived indexes/projections are not authoritative state.
10. No feature is implementation-admitted from Blueprint-only evidence.

## 7. Closure chain required before MATCH

Each feature must obtain evidence for:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`

At minimum, closure requires:

- canonical capability mapping;
- canonical API operation and request/response DTO IDs;
- canonical entity and field IDs;
- D1 authoritative persistence evidence;
- R2 object/reference evidence where applicable;
- explicit Payload integration boundary;
- ownership, organization, role, entitlement and rights authorization evidence;
- lifecycle/state transition evidence;
- async job/retry/timeout/idempotency evidence where applicable;
- cache/projection/delivery authority evidence;
- executable implementation evidence;
- positive, negative, concurrency and security-E2E tests;
- Evidence Registry records with provenance and validating commit SHA.

## 8. Admission decision

All six features remain `BLOCKED_NOT_GREEN`. No implementation authorization is granted by this batch.

This is intentional: the repository has a strong shared Content/IP contract, but the six feature-specific mapping chains are not yet evidence-complete. The next work should close concrete repository evidence, not invent implementation IDs or mark these features green prematurely.
