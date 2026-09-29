# CC-1.0-CONTENT-CORE-WIRE-STATE-AUTHORITY-2026-09-29

- Status: **BLOCKED — DECISION MATERIAL**
- Scope: LuckRead 1.0 minimum content core (create / publish / list / detail)
- Source head inspected: `854eebccbeddc9e9c4a82264bd5d8148b6f5f03d`
- Purpose: reconcile conflicting existing content API and lifecycle authorities before runtime implementation.
- This record does not delete or rewrite any existing Blueprint or Contract.

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
  → publish through an explicit state transition
  → public list
  → public detail
```

## 2. Conflicting public API authorities

Two valid repository sources currently define overlapping content API boundaries.

### A. P0 Content and IP Graph Contract

Source:
`docs/10-P0-CONTENT-AND-IP-GRAPH-CONTRACT-v1.0.md`

It defines:

- `POST /v1/content`
- `GET /v1/content/:id`
- `PATCH /v1/content/:id`
- `POST /v1/content/:id/publish`
- `POST /v1/content/:id/archive`

It also states that public API DTOs must not expose Payload document internals.

### B. Current machine-readable Content API Operation Policy / OpenAPI

Sources:
- `contracts/api/content-operation-policy.v1.json`
- `contracts/openapi/v1/openapi.yaml`
- `contracts/api/api-inventory.v1.json`

The operation policy defines `/contents` operations including:

- `GET /contents`
- `POST /contents`
- `GET /contents/{contentId}`
- `PATCH /contents/{contentId}`
- `DELETE /contents/{contentId}`
- `POST /contents/{contentId}/state`

The API inventory also contains both singular and plural content paths, including legacy/duplicate-looking surfaces.

### Conflict

The repository therefore does not currently provide one unambiguous canonical public wire namespace for the 1.0 content slice.

No implementation should choose one path by intuition.

## 3. Conflicting lifecycle authorities

`docs/10-P0-CONTENT-AND-IP-GRAPH-CONTRACT-v1.0.md` defines a lifecycle centered on:

```
DRAFT → REVIEW → SCHEDULED → PUBLISHED → ARCHIVED
                      ↓
                    FAILED

PUBLISHED → HIDDEN → RESTORED
DRAFT/ARCHIVED → DELETED
```

`contracts/enums/content-state.json` defines:

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

`contracts/api/content-operation-policy.v1.json` defines:

```
DRAFT
REVIEW_PENDING
REVIEW_REJECTED
SCHEDULED
PUBLISHED
UNPUBLISHED
ARCHIVED
DELETED
```

The names and transition vocabulary are not identical. In particular, review, approval/rejection, hidden/unpublished and restored semantics differ.

No runtime state machine should be generated from a best-effort union of these values.

## 4. Worker ownership baseline

The active canonical Worker Master assigns:

- W03 = Content / Article / Media / Translation
- W03 primary D1 = D1-02
- W01 = Public API / Gateway boundary
- W01 does not own business-state persistence

Therefore the 1.0 content runtime should preserve:

```
Client
  ↓
W01 public API boundary
  ↓
W03 content authority
  ↓
D1-02 authoritative content state
```

This is a routing/ownership baseline only. It does not authorize implementation while the API/state conflict remains unresolved.

## 5. Required authority decision

Before the first content runtime implementation is admitted, one Change Control decision must establish:

1. The canonical 1.0 public content path namespace.
2. The canonical operation IDs for create/list/detail/update/delete/publish.
3. The canonical lifecycle state vocabulary.
4. The canonical transition matrix.
5. Whether review approval is mandatory for 1.0 publication or whether a specific transition is omitted from the minimum release.
6. The canonical entity ID and field contract for CONTENT/ARTICLE.
7. The canonical W01 → W03 transport operation and evidence boundary.

The decision must preserve the existing Functional Blueprint Feature IDs and the fixed 12 Worker / 4 D1 / 25 Task topology.

## 6. Recommended decision direction

For consistency with the current machine-readable public API governance, the decision packet should evaluate the **current OpenAPI + content-operation-policy pair as the primary wire authority**, while treating older singular `/v1/content` references as historical/secondary inputs unless explicitly promoted.

For lifecycle semantics, the decision should select exactly one state contract and then reconcile all dependent contracts to it. A union of state names is explicitly prohibited.

This section is decision guidance only; it does not itself promote either source to canonical authority.

## 7. Implementation gate

Current result:

```
CONTENT-001 / CONTENT-007 / CONTENT-009 / CONTENT-010 / CONTENT-012
ARTICLE-001 / ARTICLE-002 / ARTICLE-003 / ARTICLE-011
= BLOCKED_NOT_GREEN
```

Reason:

- public wire authority conflict;
- lifecycle/state authority conflict;
- canonical content entity/field mapping not yet evidence-bound;
- executable runtime/E2E evidence does not exist for this slice.

No Payload collection is added by this document.

## 8. Next admitted implementation slice

After the authority decision is merged and its dependent reconciliation passes:

**one content slice only:**

```
Article draft/create
  → explicit publish transition
  → public list
  → public detail
```

The implementation should stay within approximately 1–3 files where practical, use W03/D1-02 ownership, preserve server-authoritative owner IDs, bounded D1 access, idempotency on mutations, and no new Worker/D1.

## 9. Non-goals

This decision material does not implement:

- collaboration;
- autosave;
- scheduled publication;
- comments;
- recommendation;
- search;
- subscription/paywall;
- video processing;
- new Payload Core behavior.

Those remain subsequent 1.0 stages.
