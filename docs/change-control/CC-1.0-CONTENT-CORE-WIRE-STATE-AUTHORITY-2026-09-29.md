# CC-1.0-CONTENT-CORE-WIRE-STATE-AUTHORITY-2026-09-29

- Status: **DECISION RECORDED / IMPLEMENTATION PENDING**
- Scope: LuckRead 1.0 minimum content core (create / publish / list / detail)
- Source head inspected: `854eebccbeddc9e9c4a82264bd5d8148b6f5f03d`
- Purpose: establish the 1.0 wire and lifecycle authority without rewriting existing Blueprint/Contract documents.
- This record is the Change Control decision for the 1.0 content-core slice; it does not itself declare runtime GREEN.

## 1. 1.0 target slice

The frozen 1.0 scope includes:

- CONTENT-001 draft
- CONTENT-007 publish/update/unpublish
- CONTENT-009 ownership
- CONTENT-010 lifecycle
- CONTENT-012 audit
- ARTICLE-001 article
- ARTICLE-002 rich text/block content
- ARTICLE-003 images/gallery
- ARTICLE-011 canonical/slug/version

The intended user path is:

```text
authenticated creator
  → create draft
  → edit
  → submit/review
  → publish through an explicit state transition
  → public list
  → public detail
```

## 2. Wire authority decision

### Decision

For the 1.0 content-core public API, the canonical wire family is the **current machine-readable plural content surface**:

```
GET   /v1/contents
POST  /v1/contents
GET   /v1/contents/{contentId}
PATCH /v1/contents/{contentId}
DELETE /v1/contents/{contentId}
POST  /v1/contents/{contentId}/state
```

Primary authority inputs:

- `contracts/openapi/v1/openapi.yaml`
- `contracts/api/content-operation-policy.v1.json`

The singular `/v1/content` family found in older P0 content documentation remains a valid historical/secondary contract input. It is **not** selected as the 1.0 public wire namespace by this Change Control.

### Rationale

1. The plural operations are represented in the current machine-readable Content API policy.
2. The current OpenAPI contains explicit operation IDs for the plural lifecycle surface.
3. The plural surface provides one explicit state-transition operation instead of relying on a special-case publish route.
4. Runtime implementation must be generated from machine-readable API contracts, not from an older prose route description.

This decision does not delete or rewrite the singular APIs. They remain outside the minimum 1.0 public wire surface until a separate reconciliation explicitly promotes them.

## 3. Lifecycle authority decision

### Decision

The 1.0 lifecycle authority is:

- `contracts/state-machines/content.json`
- `contracts/enums/content-state.json`

Canonical states:

```
DRAFT
PENDING_REVIEW
REJECTED
APPROVED
SCHEDULED
PUBLISHED
UNPUBLISHED
ARCHIVED
DELETED
RESTORED
```

Canonical transition rules are taken from `contracts/state-machines/content.json`.

In particular:

```
DRAFT
  → PENDING_REVIEW
  → APPROVED
  → PUBLISHED
```

is the normal publish path.

Direct `DRAFT → PUBLISHED` is not the default 1.0 path. The state-machine exception for an explicit auto-publish entitlement remains a separate policy decision and is not assumed by runtime code.

### Rationale

The repository already contains an executable, machine-readable transition matrix with actor, permission and event requirements. Combining state names from multiple documents would create an invalid state union, so the runtime must use one state-machine authority.

## 4. Dependent contract reconciliation

The current `contracts/api/content-operation-policy.v1.json` state list is narrower than the canonical state machine because it predates the full `APPROVED/RESTORED` vocabulary.

Therefore:

- the state machine is the authoritative transition source;
- the operation policy remains the API resource/behavior budget source;
- a dependent contract-alignment change is still required before content runtime admission so the operation policy, OpenAPI schemas and state machine describe the same 1.0 transition vocabulary.

No runtime is admitted merely because this decision has been recorded.

## 5. Worker and data authority

The active Worker Master assigns:

- W01 — Public API / Gateway boundary
- W03 — Content / Article / Media / Translation
- D1-02 — Content / Community Data

Therefore the target runtime boundary is:

```text
Client
  ↓
W01 public API boundary
  ↓
W03 content authority
  ↓
D1-02 authoritative content state
```

W01 does not become a content-data owner, and no new Worker or D1 is introduced.

## 6. Publication and security rules

The 1.0 implementation must enforce:

- server-authoritative ownerUserId;
- resource ownership and creator scope;
- explicit state transitions;
- optimistic concurrency;
- idempotency on repeatable mutations;
- private drafts excluded from public list/detail responses;
- deleted/unpublished content excluded from public cache/projection;
- moderation/approval cannot be bypassed by setting a state field directly;
- Payload CRUD is not the public API;
- cache never becomes the authorization boundary.

## 7. Runtime gate

Current result:

```
CONTENT-001 / CONTENT-007 / CONTENT-009 / CONTENT-010 / CONTENT-012
ARTICLE-001 / ARTICLE-002 / ARTICLE-003 / ARTICLE-011
= BLOCKED_NOT_GREEN
```

Remaining pre-runtime work:

1. Reconcile the plural OpenAPI operations with the canonical state-machine vocabulary.
2. Establish the canonical CONTENT/ARTICLE entity and fields.
3. Bind D1-02 persistence and optimistic-concurrency rules.
4. Define the minimal W01 → W03 transport contract.
5. Then implement one code slice and generate executable evidence.

## 8. Next implementation slice

After the dependent contract alignment passes, implement only:

```text
create DRAFT article
  → submit for review
  → approve/publish transition
  → public list
  → public detail
```

The first code slice should stay small, reuse existing infrastructure, and remain within the fixed Worker/D1 topology.

## 9. Non-goals

This decision does not implement:

- collaboration;
- autosave;
- scheduled publishing;
- comments;
- recommendation;
- search;
- subscription/paywall;
- video processing;
- new Payload Core behavior;
- a second content database;
- a parallel custom CMS.

Those remain subsequent 1.0 stages or later feature batches.
