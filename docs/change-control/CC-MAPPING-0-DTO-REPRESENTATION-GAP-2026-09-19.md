# CC-MAPPING-0-DTO-REPRESENTATION-GAP-2026-09-19

## Status

DECIDED — RECONCILIATION PENDING

## Purpose

Record a model-level Mapping 0 gap discovered during the 2026-09-19 batch audit:

The canonical Mapping record schema does not currently define a `dtoIds` / DTO-edge property, while separate canonical DTO contracts already exist for some mapped operations.

This record prevents the same condition from being repeatedly misclassified as "DTO authority does not exist".

## Verified facts

1. `contracts/alignment/cross-system-mapping.v1.schema.json` requires and permits API, Entity, Payload, Code Evidence, Evidence and Blocker arrays, but has no DTO edge property.
2. `contracts/dto/auth-dto-contract.v1.json` is an explicit DTO contract sourced from canonical OpenAPI.
3. AUTH-001 has `DTO-AUTH-REGISTER-REQUEST` and `DTO-AUTH-REGISTER-RESPONSE` with `CONTRACT_BOUND` status.
4. AUTH-002 `authLogin` has canonical request/response DTO bindings with `CONTRACT_BOUND` status.
5. AUTH-002 `authLogout` is explicitly a 204 no-body operation; no body DTO is required.
6. AUTH-010 contains reserved DTO bindings, but they remain `RESERVED_PENDING_OPENAPI_PATH`.
7. The canonical Mapping records for AUTH-001/AUTH-002 do not contain a representational DTO field because the current Mapping schema does not define one.
8. Existing blocker wording such as "DTO mapping missing" can therefore refer to a missing Feature→DTO materialization edge, not absence of the underlying DTO authority.

## Non-negotiable interpretation

This GAP MUST NOT be resolved by:
- inventing DTO IDs;
- changing canonical Feature status;
- treating documentation-only DTO text as runtime evidence;
- adding schema fields without Change Control;
- removing blocker states merely because a DTO contract exists.

## Decision required

Two controlled directions exist and require an explicit authority decision before any schema change:

A. Extend the Canonical Mapping model with an explicit DTO edge (for example, a schema-approved `dtoIds` representation), then reconcile all generators, validators and existing mapping records.

B. Keep DTO authority external to Canonical Mapping and revise blocker semantics/closure logic so DTO authority is linked through dedicated reconciliation artifacts without introducing a new canonical Mapping edge.

No decision is selected by this record.

## Gate impact

- Canonical Mapping status: unchanged.
- Mapping 0 structural gate: unchanged.
- Technical closure: unchanged.
- AUTH-001 / AUTH-002 remain fail-closed for the remaining downstream chain.
- AUTH-010 remains blocked on canonical OpenAPI path admission.

## Evidence

- `artifacts/mapping-0/dto-representation-gap-audit-2026-09-19.json`
- `artifacts/mapping-0/api-dto-four-layer-crosscheck-2026-09-19.json`
- `contracts/alignment/cross-system-mapping.v1.schema.json`
- `contracts/dto/auth-dto-contract.v1.json`

## Acceptance

The GAP is considered correctly registered when future verification consults this record first and does not re-open the same finding as a new discovery.

## Decision accepted — 2026-09-20

Decision 3 accepted: retain DTO authority outside Canonical Mapping; no dtoIds schema addition.
