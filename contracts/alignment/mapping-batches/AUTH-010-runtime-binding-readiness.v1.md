# AUTH-010 Runtime Binding Readiness v1.0

Status: NOT_READY_FOR_RUNTIME
Implementation authorization: false

## Preconditions already closed

- API operation IDs: `authSessionList`, `authSessionRevoke`
- permissions: `user.session.read`, `user.session.revoke`
- ownership boundary: self / own
- canonical entity: `ENT-SESSION`
- session field mapping frozen
- DTO identifiers reserved
- persistence boundary frozen without duplicate native session timestamps

## Runtime prerequisites still open

### 1. OpenAPI

`GET /auth/sessions` and `DELETE /auth/sessions/{sessionId}` are not yet present in the canonical OpenAPI document. DTO schema references therefore remain reserved.

### 2. Handler

No authoritative handler chain has been accepted yet for either operation. Required chain:

`HTTP -> authentication -> permission -> self ownership predicate -> session read/write -> DTO projection -> response`

### 3. Persistence

The repository contains `auth_session_state` schema definitions, including `sessionId` and extension fields. Existing persistence contract maps native `createdAt` / `expiresAt` to Payload `users.sessions[]`, while extension dimensions map to `auth_session_state`. This is schema evidence, not migration/runtime evidence.

### 4. Cache

List responses must be private/non-shared. Revoke must invalidate applicable private state and revoked state must dominate stale cache. No execution evidence has been accepted yet.

### 5. Security execution

Required negative tests include cross-account list/revoke denial and stale-cache-after-revoke protection. No Evidence Registry execution record currently closes these gates.

## Runtime implementation boundary

When implementation becomes authorized, handlers MUST NOT:

- accept client-supplied owner/user IDs for authorization;
- expose refresh credentials, hashes, token versions, or raw tokens;
- duplicate Payload-native `createdAt` / `expiresAt` into `auth_session_state`;
- treat cache presence as authorization;
- permit a stale cache result to override a persisted revocation.

## Gate decision

Remain NOT_GREEN. The next implementation prerequisite is canonical OpenAPI insertion and validation. Runtime code should not be added merely to create code evidence before that contract is canonical.
