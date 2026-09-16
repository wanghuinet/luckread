# AUTH-002 — Payload Native Session Compatibility Audit v1.0

**Status:** `CONTRACT_CLOSED / RUNTIME_EVIDENCE_REQUIRED`

## 1. Purpose

Determine whether Payload's authentication/session implementation can serve as the authoritative implementation of `ENT-SESSION` without introducing a second session authority.

This audit does not promote `ENT-SESSION`, does not create a migration, and does not infer physical schema from framework behavior.

## 2. Verified repository baseline

1. `src/collections/Users.ts` enables `auth: true`.
2. `src/payload.config.ts` configures `@payloadcms/db-d1-sqlite`, binds `cloudflare.env.D1`, sets `push: false`, and configures `src/migrations` as the migration directory.
3. The repository currently has no verified Session implementation reference and no verified applied migration evidence.
4. The canonical Session contract contains nine fields and explicit security/lifecycle invariants.

## 3. External Payload capability evidence

Payload documentation states that authentication-enabled collections receive authentication operations and that `useSessions` is enabled by default; setting `useSessions: false` switches to stateless JWT authentication. Payload also documents generated authentication fields including `sessions` when sessions are enabled.

Payload's authentication implementation therefore establishes a framework-native session capability, but this does not by itself prove field-level equivalence with the LuckRead canonical Session contract.

Payload's migration documentation establishes versioned migration files under the configured migration directory, with `up`/`down` migration functions and explicit migrate/create/status commands. The repository must still provide execution evidence before persistence is considered verified.

## 4. Compatibility matrix

| Canonical requirement | Payload native capability | Current decision |
|---|---|---|
| Session instance exists | `useSessions` enabled by default | Candidate reuse |
| Session identified by stable session identity | Runtime evidence must expose/trace session identity | Not verified |
| User association | Auth session is associated with authenticated user | Candidate reuse; runtime/schema evidence required |
| Device association | No repository evidence yet proves canonical `deviceId` binding | Blocking |
| `tokenVersion` | No verified 1:1 canonical field mapping | Blocking |
| Hashed refresh credential | Payload session/refresh semantics exist, but canonical hash field equivalence is not yet established | Blocking |
| `expiresAt` | Authentication has token expiration semantics | Candidate reuse; physical field evidence required |
| `revokedAt` | Logout/session invalidation behavior exists conceptually | Candidate reuse; durable field/runtime evidence required |
| `createdAt` | Collection/session lifecycle has timestamps/metadata | Candidate reuse; physical mapping required |
| `lastSeenAt` | No canonical repository evidence establishes this exact native field mapping | Blocking |
| Raw token non-persistence | Canonical contract requires it | Must prove with schema/runtime/telemetry evidence |
| Revocation authoritative over stale cache | Canonical contract requires fail-closed validation | Must prove by E2E test |
| Refresh replay blocked | Canonical contract requires rotation/replay protection | Must prove by concurrency test |

## 5. Decision

Payload native Session support is an **implementation candidate**, not yet an admitted canonical persistence authority.

No independent custom `sessions` table may be authored solely from the existing contract until the native implementation has been inspected at the pinned Payload version and reconciled against the canonical nine-field contract.

Conversely, Payload native Session support must not be treated as canonical merely because `auth: true` is present.

The authoritative implementation decision requires all of:

1. version-pinned Payload source/runtime inspection;
2. actual generated D1 schema inspection;
3. concrete migration artifact;
4. applied migration evidence;
5. runtime tracing of login/logout/refresh/session validation;
6. field-by-field reconciliation against `AUTH-002-session-field-contract.v1.json`;
7. security/concurrency tests;
8. Evidence Registry execution record.

## 6. Important current-version caution

A recent Payload issue reports a session-related refresh failure involving `autoLogin` when `useSessions` is enabled and indicates that real login creates a session and binds a session identifier into the JWT. This is evidence that session-backed refresh behavior is runtime-sensitive; LuckRead must therefore verify the exact pinned dependency version rather than rely on generic framework assumptions.

This issue is not treated as proof of a defect in the LuckRead deployment; it is a reason to require version-pinned runtime evidence.

## 7. Migration gate

The migration gate remains `BLOCKED` until the repository contains:

- a concrete migration under `src/migrations`;
- schema evidence matching the admitted implementation;
- migration execution/status evidence;
- no duplicate session authority;
- no undocumented secret persistence.

Payload documentation confirms that `migrationDir` controls migration location and that `migrate:create`, `migrate`, and `migrate:status` are the supported workflow. Documentation alone is not execution evidence.

## 8. Next action

The next implementation-adjacent batch is **version-pinned Payload session runtime inspection**. It must answer one binary question without architectural speculation:

> Can the pinned Payload session implementation satisfy the canonical `ENT-SESSION` semantics directly, including device binding, token invalidation, refresh rotation, revocation, expiry and audit/security constraints?

If yes, reuse the native implementation and bind it into the canonical mapping. If no, record the exact unsupported contract dimensions before designing the minimum required integration boundary.

## 9. Fail-closed rule

Until the above evidence exists:

- `ENT-SESSION` remains `PROPOSED`;
- session persistence remains unverified;
- AUTH-002 remains non-green;
- no migration may be claimed as applied;
- no runtime handler may be claimed as evidenced.
