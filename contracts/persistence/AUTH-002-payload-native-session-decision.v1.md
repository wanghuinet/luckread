# AUTH-002 — Payload Native Session Decision v1.0

**Status:** `DECISION_CLOSED / MINIMUM_INTEGRATION_CONTRACT_REQUIRED`

## 1. Decision

Payload `v3.87.1` native sessions **cannot directly serve as the canonical `ENT-SESSION` implementation** without semantic loss.

The decision is based on pinned upstream source inspection, not framework assumptions.

## 2. Pinned source facts

`UserSession` in Payload v3.87.1 is:

`{ id: string; createdAt: Date | string; expiresAt: Date | string }`

Native sessions are stored inside the authenticated User document as `user.sessions[]` rather than as an independent Session entity. Login creates a UUID session and appends it to this array. JWT authentication requires a matching session id. Logout removes the current session or clears the session array. Refresh updates the matched session expiry and signs a new JWT.

Sources:
- Payload v3.87.1 `packages/payload/src/auth/types.ts`
- Payload v3.87.1 `packages/payload/src/auth/sessions.ts`
- Payload v3.87.1 `packages/payload/src/auth/operations/login.ts`
- Payload v3.87.1 `packages/payload/src/auth/operations/logout.ts`
- Payload v3.87.1 `packages/payload/src/auth/operations/refresh.ts`
- Payload v3.87.1 `packages/payload/src/auth/strategies/jwt.ts`

## 3. Proven canonical mismatches

| Canonical dimension | Native v3.87.1 | Decision |
|---|---|---|
| `id` | `UserSession.id` exists | Reusable concept |
| `userId` | Session nested under User | Reusable relationship, different physical shape |
| `deviceId` | absent | Must be supplied by integration |
| `tokenVersion` | absent | Must be supplied by integration |
| `refreshCredentialHash` | absent; refresh extends `expiresAt` | Must be supplied by integration |
| `expiresAt` | present | Reusable semantics, subject to mapping |
| `revokedAt` | absent; logout removes session | Canonical durable revocation semantics must be supplied |
| `createdAt` | present | Reusable semantics |
| `lastSeenAt` | absent | Must be supplied by integration |

## 4. Authority model

Exactly one canonical security/session authority is allowed.

For AUTH-002 the chosen model is:

`Payload Auth entry/strategy → Canonical Session authority → application authorization/session validation`

Payload's internal `user.sessions[]` state cannot independently authorize a request once the canonical integration is enabled.

No implementation may create a second independent session table merely to mirror Payload sessions. The canonical Session record must be the authoritative security decision point for the dimensions defined by the canonical contract.

## 5. Minimum integration scope

The next contract must cover only:

1. mapping Payload user identity to canonical Session `userId`;
2. binding a privacy-safe `deviceId`;
3. issuing and validating canonical `tokenVersion`;
4. issuing, hashing, rotating and invalidating refresh credentials;
5. durable revocation semantics;
6. `lastSeenAt` update semantics;
7. ordering between Payload JWT/session recognition and canonical session validation;
8. login, logout and refresh transaction boundaries;
9. concurrency behavior for concurrent refresh and revoke;
10. failure behavior when Payload-native state and canonical Session state disagree.

## 6. Explicit non-goals

The minimum integration contract MUST NOT add:

- speculative IP history;
- geolocation history;
- risk scores;
- provider-specific secrets;
- role/entitlement fields;
- duplicated User profile fields;
- a second authorization cache that can override canonical Session authority.

## 7. Admission gates

Implementation remains blocked until the minimum integration contract proves:

- canonical Session is the only security/session authority;
- no raw credential material is persisted;
- refresh predecessor invalidation is atomic/serialized sufficiently to prevent replay success;
- revoke is idempotent and authoritative;
- expired sessions cannot authenticate;
- account-state invalidation reaches Session authority;
- stale Payload/native session state cannot override canonical revocation.

## 8. Next closure action

Create `AUTH-002 Minimum Session Integration Contract v1.0`, then implement only after that contract is closed.
