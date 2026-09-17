# AUTH-010 OpenAPI / DTO Freeze v1

- Feature: `AUTH-010`
- Operations: `authSessionList`, `authSessionRevoke`
- Status: `CONTRACT_FROZEN_PENDING_CANONICAL_OPENAPI_EDIT`
- Implementation authorization: `false`

## 1. Purpose

Freeze the exact public contract shape before runtime implementation. This document does not claim that the canonical OpenAPI file has already been changed.

## 2. Canonical operations

| Operation | Method | Path | Auth | Permission | Scope |
|---|---|---|---|---|---|
| `authSessionList` | GET | `/auth/sessions` | authenticated | `user.session.read` | self |
| `authSessionRevoke` | DELETE | `/auth/sessions/{sessionId}` | authenticated | `user.session.revoke` | self |

The API policy currently defines both operations as `CONTRACTED_PARTIAL`; OpenAPI evidence is still missing.

## 3. DTO IDs

Stable DTO IDs are reserved as follows:

- `DTO-AUTH-SESSION-LIST-RESPONSE`
- `DTO-AUTH-SESSION-REVOKE-RESPONSE`
- `DTO-AUTH-SESSION-REVOKE-PATH`

There is no request body DTO for either operation.

## 4. Session list response contract

The canonical response schema shall expose only product-safe session information:

```yaml
type: object
required: [items]
properties:
  items:
    type: array
    maxItems: 50
    items:
      type: object
      required: [sessionId, createdAt, expiresAt]
      properties:
        sessionId:
          $ref: '#/components/schemas/ResourceId'
        deviceId:
          $ref: '#/components/schemas/ResourceId'
        createdAt:
          type: string
          format: date-time
        expiresAt:
          type: string
          format: date-time
        lastSeenAt:
          type: string
          format: date-time
          nullable: true
  nextCursor:
    type: string
    nullable: true
```

Pagination remains bounded and opaque if the final list contract requires continuation. No offset pagination is introduced.

Security-only fields MUST NOT appear: refresh credential hash, token version, raw refresh credential, internal revocation metadata, or other credential material.

## 5. Session revoke contract

Path parameter:

```yaml
sessionId:
  $ref: '#/components/parameters/SessionId'
```

No request body.

Response:

- HTTP `204` on successful revoke or already-revoked idempotent no-op.
- No response body.
- No session secret or credential material.
- `403` for an authenticated caller attempting to revoke a session outside the caller's self scope, using the canonical permission/error contract.
- `404` may be used only if the canonical existence-disclosure policy permits it; this must not be invented by runtime code.

## 6. Entity mapping

Both operations consume `ENT-SESSION`, whose native Payload ownership remains defined by AUTH-002.

Persistence boundary remains:

- `id` → Payload native `users.sessions[].id`
- `createdAt` → Payload native `users.sessions[].createdAt`
- `expiresAt` → Payload native `users.sessions[].expiresAt`
- `deviceId` → `auth_session_state.device_id`
- `tokenVersion` → `auth_session_state.token_version` (never exposed)
- `refreshCredentialHash` → `auth_session_state.refresh_credential_hash` (never exposed)
- `revokedAt` → `auth_session_state.revoked_at` (never exposed)
- `lastSeenAt` → `auth_session_state.last_seen_at`

`ENT-DEVICE-RECORD` remains unresolved and is not introduced by AUTH-010.

## 7. Required canonical OpenAPI edit

The next contract edit must add both paths to `contracts/openapi/v1/openapi.yaml`, with stable operation IDs and the DTO schemas above. Only after that edit is merged shall `contracts/dto/auth-dto-contract.v1.json` be promoted from unresolved to `CONTRACT_BOUND`.

## 8. Gate

This freeze is not runtime evidence and does not make AUTH-010 green.

Required chain remains:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`.
