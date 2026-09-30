# Mapping 0 — B04-B06 Closure Plan v1

Status: ACTIVE / NOT_GREEN

Purpose: evidence-bound closure plan for the next Mapping 0 consolidation slice. This document does not declare any feature GREEN and does not create API/DTO/Entity/Field/Worker/D1 identifiers that are not already canonical.

## Admission rule

A feature may become GREEN only when the canonical mapping contains real evidence for the required chain:

Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Worker → D1 → Security → Lifecycle → Test → Evidence.

Missing, unresolved, conflicting, duplicate, drifted, extra, or blocked nodes remain non-green.

## B04 — Content / Publishing

Close only against existing canonical identifiers and repository evidence. Required checks:

- feature inventory coverage
- canonical capability/API binding
- request/response DTO binding
- Payload collection/entity binding
- authoritative fields and persistence ownership
- Worker and D1 ownership
- authorization and ownership enforcement
- lifecycle/state transitions
- integration and regression evidence

## B05 — Media / Asset

Required checks:

- metadata versus binary/object separation
- R2 ownership and access boundary where already defined by the canonical contract
- D1 metadata authority
- upload/finalize/delete lifecycle
- authorization and creator/resource ownership
- failure/retry/idempotency semantics
- integration evidence

No new storage architecture may be inferred from this plan.

## B06 — Social Graph / Interaction

Required checks:

- follow/like/comment relationship authority
- duplicate/idempotent interaction semantics
- resource ownership and visibility enforcement
- canonical API/DTO/entity/field bindings
- persistence authority
- lifecycle and deletion behavior
- test/evidence binding

## Evidence gate

Do not replace missing evidence with prose, guessed IDs, or implementation assumptions. The canonical registry remains the source for status. This plan is complete only when each referenced feature has evidence-bound mappings and the consolidation validator accepts them.

## Development gate

Mapping 0 remains locked out of implementation until the canonical registry reaches 100% GREEN and the Contract Freeze gate passes.
