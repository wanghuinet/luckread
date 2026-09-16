# AUTH-002 — Payload Native Session Compatibility Audit v1.1

**Status:** `CONTRACT_CLOSED / RUNTIME_EVIDENCE_REQUIRED`

## 1. Purpose

Determine whether Payload's authentication/session implementation can serve as the authoritative implementation of `ENT-SESSION` without introducing a second session authority.

This audit does not promote `ENT-SESSION`, does not create a migration, and does not infer physical schema from framework behavior.

## 2. Locked repository baseline

1. `package.json` pins `payload` and `@payloadcms/db-d1-sqlite` to `3.87.1`.
2. `src/collections/Users.ts` enables `auth: true`.
3. `src/payload.config.ts` configures `@payloadcms/db-d1-sqlite`, binds `cloudflare.env.D1`, sets `push: false`, and configures `src/migrations` as the migration directory.
4. The repository currently has no verified Session implementation reference and no verified applied migration evidence.
5. The canonical Session contract contains nine fields and explicit security/lifecycle invariants.

## 3. Version evidence

Payload release history records `v3.87.1` as an official release dated 2026-08-06. The LuckRead package baseline is pinned to that exact version. Compatibility decisions for AUTH-002 therefore require evidence from the pinned runtime/package rather than a generic or newer Payload baseline.

## 4. Framework capability evidence

Current Payload authentication documentation states that authentication-enabled collections receive login, logout, refresh-token and related authentication operations. Payload documents `useSessions` as enabled by default; setting `useSessions: false` switches to stateless JWT authentication.

Payload authentication operations further document that, when sessions are enabled, logout can terminate the current session or all sessions, and refresh operates against the authenticated session.

Payload's logout implementation reads the current authenticated session identifier from the request and removes either that session or all sessions from the authenticated user's session set. This establishes native session lifecycle behavior, but it does not prove that Payload's physical persistence schema is identical to the LuckRead canonical nine-field contract.

## 5. Canonical compatibility matrix

| Canonical requirement | Payload native evidence | Decision |
|---|---|---|
| Session instance exists | `useSessions` is enabled by default and logout/refresh operate on sessions | Candidate reuse |
| Stable session identity | Current implementation evidence exposes a session identifier used during logout/refresh flows | Runtime/schema proof required |
| User association | Session is stored under an authentication-enabled user collection | Candidate reuse; schema proof required |
| Device association | No verified LuckRead `deviceId` binding in current repository | **BLOCKING** |
| `tokenVersion` | No verified one-to-one native mapping to canonical `tokenVersion` | **BLOCKING** |
| `refreshCredentialHash` | Payload has refresh/session semantics, but canonical hashed-credential field equivalence and physical storage are not verified | **BLOCKING** |
| `expiresAt` | Payload authentication defines token expiration semantics | Candidate reuse; schema/runtime proof required |
| `revokedAt` | Logout invalidates the current/all sessions, but canonical durable `revokedAt` field mapping is not established | Candidate reuse only after proof |
| `createdAt` | Authentication/session lifecycle has persisted metadata, but exact canonical mapping is not verified | Candidate reuse only after proof |
| `lastSeenAt` | No verified exact native mapping | **BLOCKING** |
| Raw token/password non-persistence | Canonical contract forbids raw secret persistence | Must prove with schema/runtime/telemetry evidence |
| Revocation authoritative over stale cache | Canonical contract requires fail-closed validation | Must prove by E2E test |
| Refresh replay blocked | Canonical contract requires predecessor invalidation and concurrency safety | Must prove by concurrency test |
| Account-state invalidation | Canonical lifecycle requires immediate session invalidation for terminal states | Must prove by runtime test |

## 6. Critical architectural decision

**Do not create a custom `sessions` table at this stage.**

The native Payload session implementation is already a concrete candidate for the single session authority. Creating a parallel custom session table before proving native incompatibilities would create two potential authorities and increase migration/runtime complexity.

The next step is therefore evidence collection against the pinned `3.87.1` implementation, not schema invention.

If evidence proves that a required canonical dimension is unsupported (for example `deviceId`, `tokenVersion`, or `lastSeenAt`), the unsupported dimension must be documented first. Only then may a minimum integration extension be contracted.

## 7. Required evidence for admission

The pinned `3.87.1` implementation must produce evidence for:

1. actual persisted session representation in D1;
2. session identifier and user association;
3. session expiration and invalidation semantics;
4. refresh behavior and predecessor invalidation;
5. current-session and all-session logout behavior;
6. concurrent refresh race handling;
7. account-state-driven session invalidation;
8. exact location and protection of persisted refresh/session credential material;
9. device binding semantics or a documented unsupported dimension;
10. canonical mapping for each of the nine Session fields;
11. integration/security tests and Evidence Registry execution records.

## 8. Migration gate

The migration gate remains `BLOCKED` until the actual Payload/D1 migration artifact exists under the configured `src/migrations` path and its applied execution status is evidenced.

The repository's existing migration workflow contract explicitly states that configuration, documented CLI commands, or historical files are not execution evidence.

## 9. Current gate

```text
Payload auth capability          = PROVEN
Native session capability        = PROVEN
Pinned version                   = 3.87.1
Canonical field equivalence      = NOT PROVEN
Actual D1 session schema         = NOT VERIFIED
Migration artifact               = NOT VERIFIED
Applied migration                = NOT VERIFIED
Runtime equivalence              = NOT VERIFIED
Device binding                   = BLOCKING
Token-version mapping            = BLOCKING
Last-seen mapping                = BLOCKING
ENT-SESSION promotion            = BLOCKED
AUTH-002                         = BLOCKED_NOT_GREEN
```

## 10. Next closure action

Run the version-pinned Payload session runtime/schema evidence pass against the actual LuckRead installation. Record concrete findings only. Do not create duplicate session persistence or promote `ENT-SESSION` until the evidence chain is complete.

## Sources

- Payload v3.87.1 release: https://github.com/payloadcms/payload/releases/tag/v3.87.1
- Payload authentication overview: https://payloadcms.com/docs/authentication/overview
- Payload authentication operations: https://payloadcms.com/docs/authentication/operations
- Payload logout implementation: https://github.com/payloadcms/payload/blob/main/packages/payload/src/auth/operations/logout.ts
- LuckRead `package.json`
- LuckRead `src/collections/Users.ts`
- LuckRead `src/payload.config.ts`
