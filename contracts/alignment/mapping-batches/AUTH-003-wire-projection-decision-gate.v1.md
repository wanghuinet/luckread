# AUTH-003 Wire Projection Decision Gate v1

Status: `DECISION_GATE_CLOSED / BLOCKED_NOT_GREEN`

## Purpose

Close the first AUTH-003 wire-projection decision gate without inventing public API semantics. This artifact records what the authoritative contracts permit and what still requires an explicit product/API contract decision.

## Authority inspected

- `contracts/api/AUTH-003-credential-management-contract.v1.json`
- `contracts/entity/AUTH-003-credential-field-contract.v1.json`
- `contracts/alignment/mapping-batches/AUTH-003-dto-wire-field-matrix.v1.md`
- `contracts/alignment/mapping-batches/AUTH-003-006-openapi-promotion-input.v1.md`

## Confirmed non-public fields

The current entity field authority marks the following as non-public or forbidden:

- `id` — internal identifier; API exposure `NONE`.
- `identityId` — internal relation; API exposure `NONE`.
- `valueHash` — secret-derived material; API exposure `NONE`.
- `normalizedValue` — authentication identifier; API exposure `NEVER`.
- `verifiedAt` — verification metadata; currently `NEVER` at field authority level.
- `active` — lifecycle state; currently `NEVER` at field authority level.
- `createdAt` — audit metadata; API exposure `NONE`.
- `updatedAt` — audit metadata; API exposure `NONE`.

`kind` is an authentication metadata field with allowed values `username|email|phone`, but the public projection rule remains `FORBIDDEN_UNLESS_EXPLICITLY_REQUIRED_BY_AUTH_RESPONSE`.

## Decision result

No current authoritative artifact explicitly requires any credential field to be returned in the public AUTH-003 response DTOs.

Therefore this gate does **not** authorize a public credential item shape, and it does **not** authorize an empty response shape either: the latter would itself be a new API semantic decision.

## Remaining explicit contract decision

Before OpenAPI promotion, the API contract owner must explicitly decide:

1. whether credential metadata is returned at all;
2. if returned, which fields are public;
3. whether `kind` is public;
4. whether lifecycle/audit metadata is public;
5. whether list results use the common cursor envelope;
6. exact add/replace request field names, types, formats and requiredness;
7. exact `credentialId` parameter schema;
8. success status/body semantics for list/add/replace/remove;
9. generic conflict and validation error semantics that do not disclose account/credential existence.

## Safety decision

`NO_OPENAPI_WRITE`

`NO_DTO_REGISTRY_PROMOTION`

`NO_MAPPING_PROMOTION`

This is intentional. Entity/persistence fields, generated types, historical documents, or implementation behavior must not be used to fill these missing API decisions.

## Next execution step

Resolve the explicit AUTH-003 public projection and wire-schema contract. Once approved, encode it in the canonical AUTH-003 API contract, then promote the exact schemas into OpenAPI and reconcile Mapping-0 against the resulting canonical DTO registry.
