# CC-1.0-CONTENT-STATE-VOCABULARY-ALIGNMENT-2026-09-29

- Status: **DECISION RECORDED / IMPLEMENTATION PENDING**
- Source main after Entity Contract admission: `62028b640d914b1a50b34c9112293c3d95547960`
- Scope: 1.0 content-core lifecycle vocabulary alignment only.
- No new Worker, D1, migration, Payload collection, or runtime code.

## Decision

The machine-readable content operation policy is aligned to the already-selected canonical Content State Machine and enum:

- `contracts/state-machines/content.json`
- `contracts/enums/content-state.json`

Canonical 1.0 states are:

`DRAFT → PENDING_REVIEW → APPROVED → PUBLISHED`

with the full admitted vocabulary:

`DRAFT, PENDING_REVIEW, REJECTED, APPROVED, SCHEDULED, PUBLISHED, UNPUBLISHED, ARCHIVED, DELETED, RESTORED`

The existing operation-policy names `REVIEW_PENDING` and `REVIEW_REJECTED` were aliases that conflicted with the canonical machine-readable vocabulary. They are replaced; no new lifecycle semantics are introduced.

## Runtime guard

The public `POST /contents/{contentId}/state` operation continues to be governed by the explicit state machine. Direct state-field mutation remains prohibited.

This alignment does **not** declare runtime GREEN. Persistence, W01→W03 transport, authorization, optimistic concurrency, idempotency, cache behavior, and remote evidence remain separate admission gates.

## Non-goals

- No expansion beyond the frozen 1.0 content-core slice.
- No scheduled-publication runtime despite the state being represented.
- No separate review endpoint implementation.
- No changes to Entity Catalog.
