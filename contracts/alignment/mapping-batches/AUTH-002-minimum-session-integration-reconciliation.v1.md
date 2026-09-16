# AUTH-002 — Minimum Session Integration Reconciliation v1.0

## Status

`CONTRACTED_NOT_VERIFIED`

## Decision

Payload 3.87.1 native Session support does not satisfy the canonical `ENT-SESSION` contract by itself. The project therefore uses a **minimum integration around the native Payload session identity**, not a second independent session system.

## Native dimensions accepted as candidates

- `sid -> ENT-SESSION.id`
- native user identity -> `ENT-SESSION.userId`
- native `createdAt -> ENT-SESSION.createdAt`
- native `expiresAt -> ENT-SESSION.expiresAt`

These mappings remain unverified until actual LuckRead schema/runtime evidence exists.

## Explicit extension dimensions

- `deviceId`
- `tokenVersion`
- refresh credential verifier/hash state
- durable revocation state
- `lastSeenAt`

Each must have its own physical mapping, lifecycle, access control, migration and test evidence.

## Hard architecture constraints

1. No independent second session identifier.
2. No full duplicate `sessions` table mirroring Payload sessions.
3. Payload native `sid` remains the session-instance identity candidate.
4. Canonical integration state may invalidate or constrain native session use, but may not weaken native validation.
5. Any disagreement between native session state and canonical integration state fails closed.
6. Raw access tokens, raw refresh tokens and passwords are never persisted.

## Implementation admission gate

Implementation may begin only after the actual Payload 3.87.1 generated schema has been captured and the selected extension storage location is explicitly mapped.

Required implementation sequence:

`Schema Evidence -> Minimal Extension Storage -> Migration -> Runtime Integration -> Security/Concurrency Tests -> Evidence Registry`

## Current evidence

Payload 3.87.1 source proves native session creation uses a generated `sid` and stores `id`, `createdAt`, and `expiresAt` in the authenticated user's sessions collection data. Refresh extends `expiresAt`; logout removes the selected session. JWT validation requires the `sid` to exist in the user's current sessions. citeturn48file0turn50file0turn51file0turn52file0

This is framework source evidence, not proof of the physical LuckRead D1 schema or successful runtime execution in LuckRead.

## Blocking evidence

- actual D1 schema;
- actual generated migration;
- selected extension persistence model;
- runtime authLogin/authLogout/refresh binding;
- device binding evidence;
- tokenVersion invalidation evidence;
- refresh replay/concurrency evidence;
- revocation durability evidence;
- lastSeenAt update evidence;
- security-E2E evidence;
- Evidence Registry execution record.

## Gate result

`AUTH-002 = BLOCKED_NOT_GREEN`

`ENT-SESSION = PROPOSED`

No database migration or runtime implementation is admitted by this reconciliation alone.

## Next action

Capture the actual Payload-generated D1 schema/migration for the current `Users` auth collection, then map the minimum five extension dimensions without introducing duplicate session authority.
