# AUTH-002 — Payload 3.87.1 Session Runtime Evidence Gate v1.0

**Status:** `BLOCKED_UNTIL_VERSION_PINNED_EVIDENCE`

## 1. Purpose

This gate defines the evidence required to admit Payload's native authentication session capability as the authoritative implementation of `ENT-SESSION` for `AUTH-002`.

It does not infer the physical schema from generic Payload documentation or from the presence of `auth: true`.

## 2. Repository baseline

The LuckRead repository pins `payload` and `@payloadcms/db-d1-sqlite` to `3.87.1`. `workers/W01-payload/src/collections/Users.ts` enables `auth: true`, and `workers/W01-payload/src/payload.config.ts` uses `sqliteD1Adapter` with `push: false` and `migrationDir` under W01.

The repository's current evidence inventory records the Payload collection as discovered configuration, but does not establish an executed Session migration or runtime Session evidence.

## 3. External capability evidence

Current Payload documentation/source establishes that authentication-enabled collections support sessions by default, and that login creates a session-backed JWT containing a session identifier. Payload runtime authentication also checks that the referenced session still exists when `useSessions` is enabled. Logout removes the current session or all sessions, depending on the operation mode. citeturn785443search7turn785443search3turn785443search8turn668249search3

These sources establish capability semantics, not LuckRead deployment evidence.

## 4. Version-pinning rule

The exact Payload `3.87.1` package/runtime must be the artifact under test.

A `main` branch source snapshot or a later Payload release MUST NOT be accepted as direct implementation evidence for the pinned dependency.

The following must be captured from the installed dependency used by the project:

- exact package version;
- package integrity/lockfile reference;
- resolved module/runtime entry;
- session-related source or generated runtime behavior used by the installed package;
- test execution against the same dependency set.

## 5. Required runtime probes

### 5.1 Login

Given valid credentials:

- authentication succeeds;
- exactly one new session instance is attributable to the authenticated user for the login operation;
- the issued JWT/token carries the session identity used by subsequent session validation;
- raw credential material is not persisted or logged;
- account-state and anti-abuse gates execute before session admission.

### 5.2 Session validation

For a valid token/session pair:

- the session identifier resolves to an existing session;
- the session belongs to the authenticated user;
- missing session identity causes authentication failure when sessions are enabled;
- expired session/token is rejected;
- revoked/deleted session is rejected.

Payload's current JWT strategy source explicitly checks the decoded session id against the user's stored sessions when `useSessions` is enabled. citeturn785443search8

### 5.3 Logout

For current-session logout:

- only the authenticated current session is removed/revoked;
- unrelated sessions remain valid;
- repeat logout is deterministic and does not corrupt unrelated session state.

Payload's current logout operation filters the session identified by `req.user._sid`, or clears all sessions when `allSessions` is requested. citeturn668249search3

### 5.4 Refresh

For session-backed refresh:

- the current session identity is preserved or deterministically replaced according to the exact installed implementation;
- expired tokens are rejected;
- invalid/missing session identity is rejected;
- refresh behavior is verified under concurrent requests;
- replay behavior is captured as evidence rather than inferred.

Payload documents refresh as an authenticated operation requiring a non-expired token. citeturn785443search1

## 6. Canonical Session field reconciliation

The following canonical fields must each receive one of:

`NATIVE_EQUIVALENT` | `ADAPTER_MAPPING_REQUIRED` | `CUSTOM_CONTRACT_REQUIRED` | `NOT_SUPPORTED`

Fields:

- `id`
- `userId`
- `deviceId`
- `tokenVersion`
- `refreshCredentialHash`
- `expiresAt`
- `revokedAt`
- `createdAt`
- `lastSeenAt`

No field may be marked `NATIVE_EQUIVALENT` without concrete installed-version schema/runtime evidence.

## 7. Device boundary

Payload native authentication does not, from the currently admitted evidence, establish the LuckRead canonical `deviceId` relationship.

Therefore `deviceId` remains a hard compatibility gate until a concrete implementation mapping and security/privacy test are available.

No device fingerprint, IP history, geolocation, or speculative risk field may be introduced into `ENT-SESSION` as a workaround.

## 8. Token-version boundary

`tokenVersion` is a LuckRead canonical authorization-state field. Presence of a Payload session id does not prove semantic equivalence.

A global account/session invalidation mechanism that relies on `tokenVersion` may only be admitted after an executable test proves that stale tokens cannot authenticate after the authoritative version changes.

## 9. Refresh credential boundary

The canonical field `refreshCredentialHash` is secret-derived material and must never be exposed through public/admin DTOs, events, analytics, or logs.

Payload's generic session/JWT capability is not sufficient to declare this field equivalent. The installed implementation must be inspected and tested for actual refresh credential persistence/rotation semantics.

## 10. Migration gate

No final Session migration may be authored from this audit alone.

A migration may be admitted only after the installed Payload implementation's actual D1 schema has been captured and reconciled with the canonical field contract.

The migration evidence must identify:

`Entity → Field → Payload runtime field → physical table → physical column → SQL type → nullability → index/uniqueness → lifecycle`

## 11. Evidence package required for promotion

Promotion of `ENT-SESSION` from `PROPOSED` to `VERIFIED` requires all of:

1. exact Payload 3.87.1 dependency resolution evidence;
2. actual generated/installed D1 schema inspection;
3. concrete migration artifact;
4. migration execution result;
5. migration status result;
6. login session creation evidence;
7. logout revocation evidence;
8. session validation evidence;
9. refresh evidence;
10. concurrent refresh/replay evidence;
11. account-state invalidation evidence;
12. device binding evidence or a separately approved integration boundary;
13. secret non-persistence evidence;
14. Evidence Registry execution record.

## 12. Current decision

Payload native sessions are **ADMITTED AS A REUSE CANDIDATE ONLY**.

The canonical `ENT-SESSION` remains `PROPOSED`.

No duplicate custom Session authority is authorized.

No physical Session schema is authorized until the installed Payload 3.87.1 runtime and actual D1 schema are inspected.

## 13. Fail-closed rule

Documentation, source on another Payload branch/version, generated types, `auth: true`, or existence of an auth endpoint cannot independently promote `ENT-SESSION` or AUTH-002 to GREEN.

The promotion chain remains:

`Pinned Dependency → Runtime → Actual Schema → Migration → Field Reconciliation → Security Tests → Evidence Registry → VERIFIED`
