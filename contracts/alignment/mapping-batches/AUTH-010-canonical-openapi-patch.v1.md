# AUTH-010 Canonical OpenAPI Patch v1

- Feature: `AUTH-010`
- Status: `PATCH_SPEC_READY_OPENAPI_EDIT_PENDING`
- Implementation authorization: `false`
- Canonical OpenAPI file: `contracts/openapi/v1/openapi.yaml`
- DTO contract: `contracts/dto/auth-dto-contract.v1.json`

## 1. Required paths

The canonical OpenAPI contract must add exactly these two operations under `paths`:

### `GET /auth/sessions`

- `tags`: `[Auth]`
- `summary`: `List current user's sessions`
- `operationId`: `authSessionList`
- authentication: inherited bearer security
- permission: `user.session.read`
- scope: current authenticated user only
- parameters:
  - `Cursor`
  - `Limit`
- response `200`:
  - media type `application/json`
  - schema: inline object until promoted to a reusable component
  - required: `items`
  - `items` maxItems: `50`
  - item required fields: `sessionId`, `createdAt`, `expiresAt`
  - optional fields: `deviceId`, `lastSeenAt`
  - `nextCursor`: nullable opaque string
- response `4XX`: canonical `ClientError`

### `DELETE /auth/sessions/{sessionId}`

- `tags`: `[Auth]`
- `summary`: `Revoke one current user's session`
- `operationId`: `authSessionRevoke`
- authentication: inherited bearer security
- permission: `user.session.revoke`
- scope: current authenticated user only
- path parameter:
  - `sessionId`
  - required
  - `$ref: '#/components/schemas/ResourceId'`
- no request body
- response `204`: no body; revoke is idempotent for an already-revoked owned session
- response `403`: canonical `PermissionDenied`
- response `4XX`: canonical `ClientError`

## 2. Security exclusions

The OpenAPI response schemas MUST NOT expose:

- raw refresh credentials
- `refreshCredentialHash`
- `tokenVersion`
- internal revocation timestamps or internal state metadata
- any credential material

`createdAt` and `expiresAt` are public session metadata sourced from the native Payload session contract. They must not be duplicated into the extension persistence schema.

## 3. Entity boundary

Both operations consume `ENT-SESSION`. AUTH-010 does not redefine the session entity.

`deviceId` and `lastSeenAt` are extension dimensions backed by `auth_session_state`. `tokenVersion`, `refreshCredentialHash`, and `revokedAt` remain security/persistence fields and are not DTO fields.

`ENT-DEVICE-RECORD` remains unresolved and MUST NOT be introduced by this patch.

## 4. DTO binding gate

The DTO contract has reserved stable IDs in commit `cf457b4f3bca276b0508390a67307af5b6126475`, but those records intentionally remain `RESERVED_PENDING_OPENAPI_PATH` until the canonical OpenAPI paths exist.

Therefore:

`API Policy -> DTO reservation -> Canonical OpenAPI -> DTO CONTRACT_BOUND -> Mapping -> Runtime`

is the required order.

## 5. Non-goals

This patch does not authorize:

- route handlers
- persistence implementation
- cache implementation
- authorization implementation
- migration changes
- lifecycle event implementation
- integration tests
- evidence registration

AUTH-010 remains non-green until executable evidence closes the full chain.
