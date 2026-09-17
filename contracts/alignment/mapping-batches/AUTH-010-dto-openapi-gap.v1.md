# AUTH-010 DTO / OpenAPI Gap Reconciliation v1

- Feature: `AUTH-010`
- Operations: `authSessionList`, `authSessionRevoke`
- Status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`

## 1. Verified canonical operation policy

The auth operation policy defines:

- `authSessionList` → `GET /auth/sessions`
- `authSessionRevoke` → `DELETE /auth/sessions/{sessionId}`

Both are `CONTRACTED_PARTIAL`.

`authSessionList` is a self-scoped bounded read with a maximum of 50 rows, private/non-shared cache semantics, and no client retry beyond the single attempt.

`authSessionRevoke` is a self-scoped authoritative write, permits one read and one write, requires idempotent revoke semantics, and requires private-cache invalidation.

## 2. OpenAPI verification

The repository's canonical OpenAPI source is `contracts/openapi/v1/openapi.yaml`.

Repository search and direct inspection confirm that the current OpenAPI document contains the existing auth operations (`authRegister`, `authLogin`, `authLogout`) but does not currently expose `/auth/sessions` or `/auth/sessions/{sessionId}`.

Therefore the following bindings are currently **MISSING**, not inferred:

| Operation | OpenAPI path | Request DTO | Response DTO | Status |
|---|---|---|---|---|
| `authSessionList` | missing | no request body | missing | `OPENAPI_MISSING` |
| `authSessionRevoke` | missing | no request body | missing | `OPENAPI_MISSING` |

The existing DTO contract explicitly states that canonical DTO bindings must point to operations actually present in the OpenAPI contract and that implementation remains gated by evidence. Therefore no DTO IDs are invented in this pass.

## 3. Required canonical DTO shape

Before runtime implementation, the OpenAPI contract must define stable DTO schemas.

### `authSessionList`

Expected response semantics, subject to final OpenAPI schema review:

- bounded list of sessions owned by the authenticated subject;
- opaque cursor pagination if pagination is required by the final contract;
- session identifier;
- device identifier or privacy-safe device presentation;
- creation time;
- expiry time;
- last-seen time;
- revocation state only where the product contract requires it.

Raw refresh credentials, credential hashes, token versions, and other security-only persistence fields MUST NOT be exposed by this DTO.

### `authSessionRevoke`

Expected request semantics:

- path parameter `sessionId` only;
- no credential material in request body.

Expected response semantics:

- idempotent successful revoke result;
- no session secret or credential hash;
- exact status code and error model must be defined by the OpenAPI contract.

These are mapping requirements, not runtime evidence.

## 4. Entity boundary

Both DTOs consume canonical `ENT-SESSION` fields owned by AUTH-002. AUTH-010 MUST NOT create a second Session entity or redefine the Session field authority.

`deviceId` is currently only an `ENT-SESSION` field relation. `ENT-DEVICE-RECORD` remains separately unresolved and must not be invented here.

## 5. Security boundary

The DTO/OpenAPI layer MUST preserve the canonical authorization requirements:

- `authSessionList` → `user.session.read`, scope `self`;
- `authSessionRevoke` → `user.session.revoke`, scope `self`;
- cross-account session access must fail;
- revoked sessions must not become visible through stale shared cache;
- revoke must dominate cache state.

DTO/OpenAPI presence alone cannot satisfy these security gates.

## 6. Admission decision

`AUTH-010 DTO/OpenAPI = BLOCKED_NOT_GREEN`.

No runtime implementation should be authorized solely from the operation policy. The next valid closure step is to add the two canonical paths to `contracts/openapi/v1/openapi.yaml`, define stable DTO schema references, then reconcile those definitions back into the DTO contract and Mapping.

Required chain remains:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`.
