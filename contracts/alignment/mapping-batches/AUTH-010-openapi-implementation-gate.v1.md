# AUTH-010 Canonical OpenAPI Implementation Gate v1.0

Status: BLOCKED_NOT_GREEN
Implementation authorization: false

## Gate purpose

Freeze the exact OpenAPI change required before AUTH-010 DTO bindings can become executable contract bindings.

## Required canonical operations

### authSessionList

- method: `GET`
- path: `/auth/sessions`
- authentication: bearer / authenticated current user
- permission: `user.session.read`
- scope: self / own
- query: opaque `cursor`, bounded `limit`
- maximum returned rows: 50
- response: `200 application/json`
- response must expose only privacy-safe session fields
- refresh credentials, refresh credential hashes, token versions and raw tokens are forbidden
- cache: private/non-shared only

### authSessionRevoke

- method: `DELETE`
- path: `/auth/sessions/{sessionId}`
- authentication: bearer / authenticated current user
- permission: `user.session.revoke`
- scope: self / own
- path parameter `sessionId` binds to `ENT-SESSION-F-ID`
- request body: none
- successful response: `204`
- operation is idempotent
- revoke must invalidate the applicable private cache state
- revoked state must dominate stale cache

## DTO binding gate

The DTO contract has already reserved:

- `DTO-AUTH-SESSION-LIST-RESPONSE`
- `DTO-AUTH-SESSION-REVOKE-PATH`
- `DTO-AUTH-SESSION-REVOKE-RESPONSE`

Those bindings remain reserved rather than canonical until the two paths and operation IDs exist in `contracts/openapi/v1/openapi.yaml`.

## Entity binding

Canonical entity: `ENT-SESSION`.

Public response fields are limited to the previously frozen session field mapping:

- `id`
- `deviceId`
- `createdAt`
- `expiresAt`
- `lastSeenAt`
- `nextCursor` as transport state only

The following remain internal and MUST NOT enter public DTOs:

- `userId`
- `tokenVersion`
- `refreshCredentialHash`
- raw refresh credential/token material

Payload-native `users.sessions[].id`, `createdAt`, and `expiresAt` remain authoritative. `auth_session_state` supplies extension dimensions such as `deviceId`, `tokenVersion`, `refreshCredentialHash`, `revokedAt`, and `lastSeenAt`.

## Current evidence

The canonical OpenAPI file has been inspected and currently does not contain the required `/auth/sessions` paths. Therefore no implementation or Evidence Registry PASS is authorized from this gate.

## Required closure evidence

1. Canonical OpenAPI contains both paths.
2. `operationId` values exactly match `authSessionList` and `authSessionRevoke`.
3. Permission and self/own scope match the API policy and permission catalog.
4. DTO schema references resolve against the canonical OpenAPI document.
5. OpenAPI validation passes.
6. Only then may runtime handler binding begin.

## Explicit non-goals

This gate does not authorize:

- runtime handler implementation;
- D1 migration changes;
- duplicate `createdAt` / `expiresAt` columns;
- creation of a second session entity;
- cache implementation;
- security-E2E PASS;
- Evidence Registry PASS.
