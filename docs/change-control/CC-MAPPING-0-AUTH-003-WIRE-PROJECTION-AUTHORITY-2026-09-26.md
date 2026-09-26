# Change Control — AUTH-003 Public Wire Schema Authority
## 2026-09-26

- Control ID: `CC-MAPPING-0-AUTH-003-WIRE-PROJECTION-AUTHORITY-2026-09-26`
- Scope: Mapping 0 / AUTH-003 API-Wire/DTO authority only
- Status: `CLOSED — PASS_VERIFIED`
- Decision authority: project review/acceptance process under the delegated Mapping-0 authority decision record
- Implementation authorization: `false`
- Runtime/persistence authorization: `false`

## Decision basis

The decision uses only existing repository-wide API contracts and already accepted AUTH-003 operation authority:
- `contracts/api/AUTH-003-credential-management-contract.v1.json`
- `contracts/entity/AUTH-003-credential-field-contract.v1.json`
- `contracts/schemas/common/list-response.json`
- `docs/03-P0-API-ERROR-PAGINATION-CURSOR-CONTRACT-v1.0.md`
- `contracts/schemas/common/error-response.json`
- `contracts/enums/error-code.json`
- `contracts/api/revision.v1.json`
- existing AUTH-003 wire-field / request / replace audits

No Worker, D1, migration, or runtime behavior is used as wire-schema authority.

## Canonical public resource identity

1. Public path parameter is `credentialId`.
2. `credentialId` uses the canonical `ResourceId` wire shape:
   - string
   - minLength 1
   - maxLength 128
3. `credentialId` is an opaque canonical public resource identifier.
4. It is **not** a direct exposure of a Payload/database internal primary key.
5. The API representation is named `credentialId` and is distinct from the internal entity field `id` authority.

This resolves the existing contradiction between the required public path locator and the entity rule that internal `id` is not directly public.

## Public response projection

The public credential item projection is exactly:
- `credentialId`
- `kind`
- `active`

No credential input value, normalized value, value hash, identityId, verification metadata, createdAt, or updatedAt is returned.

`kind` is public for credential-management UX and uses:
`username | email | phone`.

`active` is public lifecycle state for the current user's own credential-management surface.

## Add request

`POST /auth/credentials`

Request body:
- `kind`: required enum `username | email | phone`
- `value`: required string, minLength 1

Unknown properties are rejected.

Validation/normalization follows the already contracted AUTH-003 domain rules:
- username: trim → Unicode NFC → casefold
- email: trim → Unicode NFC → casefold; no provider-specific transformation without a separate contract
- phone: parse and validate as E.164

## Replace request

`PUT /auth/credentials/{credentialId}`

Request body:
- `value`: required string, minLength 1

`kind` is **not accepted** on replace. Credential kind is immutable for the credential selected by `credentialId`; changing kind is performed as a separate add/remove lifecycle.

Unknown properties are rejected.

## List semantics

`GET /auth/credentials`

1. Uses the canonical cursor pagination contract.
2. Query parameters are `cursor` and `limit`.
3. Default limit = 50.
4. Maximum limit = 100.
5. Cursor is opaque.
6. Canonical response envelope is the common `data.items + nextCursor + hasMore + requestId` form.
7. Empty result is a successful 200 response with an empty `data.items` array.
8. Deterministic ordering is `createdAt DESC, credentialId DESC`; the ordering is internal list semantics and does not expose timestamps.
9. Invalid/expired cursor errors use the canonical `INVALID_CURSOR` / `CURSOR_EXPIRED` codes under the canonical client-error envelope.

## Success semantics

- list: `200`
- add: `201`
- replace: `200`
- remove: `204 No Content`

Remove has no response body.

## Error semantics

All errors use the canonical `ErrorResponse`.

- authentication missing: `401 UNAUTHENTICATED`
- self-scope/permission failure: `403 PERMISSION_DENIED`
- unknown or inaccessible credential resource: `404 NOT_FOUND`
- credential uniqueness conflict or protected lifecycle conflict: `409 CONFLICT` or `409 INVALID_STATE` as applicable
- malformed input / unknown properties / validation failure / required-idempotency failures / invalid or expired cursor: canonical client-error codes with `422` status
- rate limiting: `429 RATE_LIMITED`

Credential-conflict responses must remain generic and must not disclose protected account/credential existence.

## Idempotency

Add, Replace and Remove retain the existing required `Idempotency-Key` contract.

No new idempotency semantics are introduced beyond the existing canonical error codes.

## Explicit non-changes

- No new Worker.
- No new D1 database/domain.
- No D1 table/column/index decision.
- No migration decision.
- No runtime implementation admission.
- No entity promotion.
- No Evidence Registry promotion.
- No Mapping-0 GREEN promotion.

## Reconciliation result

`M0-AUTH-003-WIRE-PROJECTION-AUTHORITY-001 = PASS_VERIFIED`

Next gate:
encode this exact authority into the canonical AUTH-003 API contract, OpenAPI, and DTO registry; then reconcile the AUTH-003 persistence mapping operation/DTO references. Runtime and persistence evidence remain separate downstream gates.
