# AUTH-002 — Session Authentication Real-Evidence Reconciliation v1.1

## Status

`BLOCKED_NOT_GREEN`

## Scope

Canonical feature: `AUTH-002` — login / logout.

Canonical operations currently evidenced by repository contracts:
- `authLogin` — `POST /auth/login`
- `authLogout` — `POST /auth/logout`

## Evidence-supported facts

1. `contracts/openapi/v1/openapi.yaml` defines `authLogin` with request fields `identity` and `credential`, and a 200 response containing `accessToken`, `refreshToken`, `expiresIn`, and `layer`.
2. `contracts/openapi/v1/openapi.yaml` defines `authLogout` as a 204 no-body operation.
3. `contracts/api/auth-operation-policy.v1.json` defines anti-abuse, account-state evaluation, refresh rotation requirements for login, and current-user/self-scope plus idempotent revocation requirements for logout.
4. `contracts/dto/auth-dto-contract.v1.json` canonically binds `authLogin` to `DTO-AUTH-LOGIN-REQUEST` and `DTO-AUTH-LOGIN-RESPONSE`.
5. `contracts/dto/auth-dto-records.v1.json` records those login DTO schema references. `authLogout` is explicitly recorded as a no-body operation.
6. `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md` provides L5/L6 validation claims for session creation, refresh rotation, session revocation, concurrent-session policy, session listing, device binding, expiry, login events, and compromised-session revocation.
7. `contracts/entity/AUTH-002-session-field-contract.v1.json` freezes the canonical AUTH-002 Session field contract with explicit field IDs, types, nullability, lifecycle, classification, exposure boundaries, security invariants and verification requirements.
8. `contracts/persistence/AUTH-002-session-persistence-migration-runtime-contract.v1.json` defines the required D1 persistence mapping, migration invariants, runtime read/write boundaries, refresh/revocation concurrency semantics and required evidence. It remains `CONTRACTED_NOT_VERIFIED`.
9. `contracts/persistence/AUTH-002-payload-session-integration-boundary.v1.json` defines the single-authority boundary between Payload authentication and canonical Session persistence.
10. `contracts/persistence/AUTH-002-payload-3.87.1-session-runtime-evidence-gate.v1.md` defines version-pinned evidence requirements.
11. `contracts/persistence/AUTH-002-payload-native-session-decision.v1.md` records the decision that Payload native Session cannot directly satisfy the canonical Session contract without semantic loss.
12. Pinned Payload v3.87.1 source confirms `UserSession` contains only `id`, `createdAt`, and `expiresAt`, and is persisted inside the authenticated User document as `user.sessions[]` rather than as an independent Session entity. (Pinned sources: `packages/payload/src/auth/types.ts`, `packages/payload/src/auth/sessions.ts`.)
13. Pinned Payload v3.87.1 login creates a session UUID, persists `createdAt`/`expiresAt`, and places the session id into the JWT as `sid`. (Pinned source: `packages/payload/src/auth/operations/login.ts`.)
14. Pinned Payload v3.87.1 JWT authentication requires a matching `user.sessions[].id`; otherwise authentication returns no user. (Pinned source: `packages/payload/src/auth/strategies/jwt.ts`.)
15. Pinned Payload v3.87.1 logout removes the current session from `user.sessions`, or clears the array for all-session logout. It does not provide the canonical durable `revokedAt` field. (Pinned source: `packages/payload/src/auth/operations/logout.ts`.)
16. Pinned Payload v3.87.1 refresh updates the matched session `expiresAt` and signs a new JWT; it does not replace a persisted refresh-credential hash or implement the canonical predecessor-credential rotation model. (Pinned source: `packages/payload/src/auth/operations/refresh.ts`.)
17. Pinned Payload v3.87.1 JWT signing includes `id`, `collection`, `email`, optional `sid`, plus configured `saveToJWT` fields, and uses HS256 with JWT expiration. (Pinned sources: `packages/payload/src/auth/getFieldsToSign.ts`, `packages/payload/src/auth/jwt.ts`.)

## Mapping decision

Evidence-backed links may be retained:

- `AUTH-002 -> authLogin`
- `AUTH-002 -> authLogout`
- `AUTH-002 -> DTO-AUTH-LOGIN-REQUEST`
- `AUTH-002 -> DTO-AUTH-LOGIN-RESPONSE`
- `AUTH-002 -> L5/L6 session validation claims in docs/184-*`
- `AUTH-002 -> ENT-SESSION -> contracts/entity/AUTH-002-session-field-contract.v1.json`
- `ENT-SESSION -> contracts/persistence/AUTH-002-session-persistence-migration-runtime-contract.v1.json`
- `AUTH-002 -> contracts/persistence/AUTH-002-payload-session-integration-boundary.v1.json`
- `AUTH-002 -> contracts/persistence/AUTH-002-payload-3.87.1-session-runtime-evidence-gate.v1.md`
- `AUTH-002 -> contracts/persistence/AUTH-002-payload-native-session-decision.v1.md`

### Resolved at contract/source-analysis layer

- canonical session field IDs and semantics;
- explicit secret/non-secret classification and exposure boundary;
- persistence and migration invariants;
- Runtime session creation/logout/validation/refresh boundaries;
- Payload native-vs-canonical Session authority boundary;
- pinned Payload v3.87.1 source analysis;
- decision that native Payload Session is not directly canonical-equivalent.

### Proven native incompatibilities

The following canonical dimensions are absent or semantically incompatible in Payload v3.87.1 native Session:

- `deviceId` — absent;
- `tokenVersion` — absent;
- `refreshCredentialHash` — absent; native refresh extends session expiry instead;
- `revokedAt` — absent; native logout removes the session entry;
- `lastSeenAt` — absent.

Therefore **direct native promotion of `ENT-SESSION` is rejected**.

### Remaining blocking evidence

- actual LuckRead D1 schema evidence;
- concrete migration artifact and applied migration result;
- chosen minimum integration implementation contract;
- runtime implementation binding for canonical Session authority;
- device-record authority and relationship evidence;
- refresh rotation/replay protection tests;
- revocation and expiry E2E tests;
- account-state-driven invalidation tests;
- anti-abuse executable evidence;
- integration/concurrency/security evidence;
- Evidence Registry execution records.

## Security boundary

Credentials and session secrets must not become public DTO fields, logs, analytics payloads, feed/search data, or client-controlled authorization state. Session revocation must remain authoritative over stale cache or stale credentials.

The canonical field and persistence contracts forbid raw access/refresh token persistence and forbid public/admin/event exposure of `refreshCredentialHash`.

## Fail-closed rule

This reconciliation does not promote `AUTH-002` to GREEN. Framework behavior, source inspection, contract existence, or L5/L6 claims do not substitute for executed LuckRead schema, migration, runtime, security, test and Evidence Registry evidence.

Required chain:

`Feature -> API -> DTO -> Session Entity -> Field -> Persistence -> Migration -> Code -> Security -> Lifecycle -> Test -> Evidence`

## Next closure action

Create the **AUTH-002 Minimum Session Integration Contract v1.0**. It must define the exact single-authority model, synchronization boundary with Payload auth, and implementation semantics for the five proven native gaps before any migration or runtime code is authored.
