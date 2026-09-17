# AUTH-010 Real Evidence Reconciliation v1

- Feature: `AUTH-010`
- Name: session/device management
- Reconciliation status: `BLOCKED_NOT_GREEN`
- Implementation authorization: `false`

## 1. Canonical feature scope

AUTH-010 is frozen as:

`Identity / Auth / Account` → `Session security` → `Session and device registry` → `Sessions/devices` → `View and revoke sessions/devices` → `List owned sessions/devices and revoke a selected session`.

The current B01 capability reconciliation states that scope is self-only unless a separately authorized administrative flow exists, and that revocation is authoritative and idempotent.

## 2. Confirmed canonical API evidence

The canonical auth operation policy contains:

- `authSessionList`: `GET /auth/sessions`, authenticated current-user scope, permission `user.session.read`, bounded read, private/non-shared cache boundary, one-attempt client retry policy.
- `authSessionRevoke`: `DELETE /auth/sessions/{sessionId}`, authenticated current-user scope, permission `user.session.revoke`, authoritative write, private-cache invalidation, idempotent revoke semantics.

Both operations remain `CONTRACTED_PARTIAL`.

## 3. Confirmed security requirements

`authSessionList` requires self-only scope and must not allow revoked sessions to remain visible through stale cache.

`authSessionRevoke` requires self-only scope, must reject cross-account session access, and revocation must dominate cache state.

## 4. AUTH-002 ↔ AUTH-010 boundary decision

The canonical entity registry identifies `ENT-SESSION` as the session entity and references `contracts/entity/AUTH-002-session-field-contract.v1.json`. The entity/field contract remains `CONTRACTED_NOT_VERIFIED`; therefore AUTH-010 may **consume the canonical AUTH-002 session authority but may not independently redefine Session fields or create a second session authority**.

The canonical Session field contract currently defines these nine fields:

- `ENT-SESSION-F-ID` → `id`
- `ENT-SESSION-F-USER-ID` → `userId`
- `ENT-SESSION-F-DEVICE-ID` → `deviceId`
- `ENT-SESSION-F-TOKEN-VERSION` → `tokenVersion`
- `ENT-SESSION-F-REFRESH-CREDENTIAL-HASH` → `refreshCredentialHash`
- `ENT-SESSION-F-EXPIRES-AT` → `expiresAt`
- `ENT-SESSION-F-REVOKED-AT` → `revokedAt`
- `ENT-SESSION-F-CREATED-AT` → `createdAt`
- `ENT-SESSION-F-LAST-SEEN-AT` → `lastSeenAt`

This establishes the mapping direction for AUTH-010:

`AUTH-010 → ENT-SESSION (AUTH-002 authority) → canonical Session fields/persistence`

It does **not** establish executable runtime or migration evidence.

## 5. Newly confirmed persistence/code evidence

Repository inspection confirms concrete session extension schema code exists in `src/db/auth-session-state.ts` and is registered in `src/payload.config.ts` as the `auth_session_state` raw table/schema.

Confirmed fields in that implementation are:

- `session_id` — primary key
- `user_id`
- `device_id`
- `token_version`
- `refresh_credential_hash`
- `revoked_at`
- `last_seen_at`

Confirmed indexes exist for user, device, token version and revoked-at fields.

The implementation therefore provides concrete persistence evidence for **7 of the 9 canonical Session fields** by semantic correspondence:

| Canonical field | Persistence evidence | Decision |
|---|---|---|
| `id` | `session_id` | Bound by semantic identity, runtime binding still unverified |
| `userId` | `user_id` | Bound by semantic owner relation, runtime binding still unverified |
| `deviceId` | `device_id` | Bound by semantic device relation, runtime binding still unverified |
| `tokenVersion` | `token_version` | Bound by semantic authorization state, runtime binding still unverified |
| `refreshCredentialHash` | `refresh_credential_hash` | Bound by semantic secret-derived state, runtime/security evidence still unverified |
| `expiresAt` | **no confirmed field** | BLOCKED — persistence mapping missing |
| `revokedAt` | `revoked_at` | Bound by semantic revocation state, authoritative write evidence still unverified |
| `createdAt` | **no confirmed field** | BLOCKED — persistence mapping missing |
| `lastSeenAt` | `last_seen_at` | Bound by semantic observation state, runtime update evidence still unverified |

This is an important closure result: the discovered table must **not** be treated as a complete implementation of `ENT-SESSION` until the missing `expiresAt` and `createdAt` persistence mappings are explicitly reconciled and migration evidence exists.

The persistence contract `AUTH-002-minimum-session-extension-persistence-contract.v1.1.json` defines `ENT-SESSION`, the native Payload `users.sessions[]` relationship, the same extension fields, and fail-closed/session lifecycle rules. However, that contract is explicitly `CONTRACTED_NOT_VERIFIED`; migration/runtime/test/evidence readiness remains open.

## 6. Device authority boundary

`ENT-DEVICE-RECORD` is still `PROPOSED` with no canonical field contract. Therefore the word `device` in AUTH-010's feature scope cannot yet be promoted into an independent entity mapping.

For the current closure pass, `deviceId` is treated only as the canonical `ENT-SESSION-F-DEVICE-ID` relation required by AUTH-002. AUTH-010 must not invent an `ENT-DEVICE-RECORD` schema, fields, collection, or runtime authority to fill this gap.

A separate device contract is required before AUTH-010 can claim a fully reconciled device registry surface.

## 7. Important runtime boundary

The discovered `auth_session_state` code is evidence of a persistence/schema implementation, but it is **not** evidence that AUTH-010 list/revoke endpoints are implemented.

The source file comments identify this table as the minimal extension state for AUTH-002. Therefore AUTH-010 must consume that authority through an explicit runtime binding rather than claim ownership from name/field similarity.

Repository search still found no concrete handler implementing both `authSessionList` and `authSessionRevoke`, and no authoritative handler → DTO → authorization → persistence → lifecycle → response chain for AUTH-010.

## 8. Remaining blockers

1. Bind `authSessionList` and `authSessionRevoke` to the canonical `ENT-SESSION` entity/field IDs without duplicating or overriding AUTH-002 authority.
2. Reconcile the missing `expiresAt` and `createdAt` persistence mappings; do not infer them from Payload timestamps.
3. Establish canonical DTO/OpenAPI request/response definitions for list/revoke.
4. Establish concrete runtime handlers and self-scope authorization evidence.
5. Establish authoritative lifecycle/event semantics for list/revoke, including revocation dominance over stale cache.
6. Prove executable migration/application state for the session schema.
7. Define and validate `ENT-DEVICE-RECORD` separately before claiming complete device-registry mapping.
8. Add positive/negative integration/security tests and actual Evidence Registry execution references.

## 9. GREEN decision

`AUTH-010 = BLOCKED_NOT_GREEN`.

No promotion to GREEN is made in this pass. The AUTH-002 ↔ AUTH-010 boundary is now explicitly reconciled at the contract level, but the missing persistence fields, device entity authority, runtime handler, DTO/OpenAPI, security, lifecycle, migration and execution evidence prevent promotion.

Required final chain:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`.

## 10. Next closure action

Proceed in this order:

1. close the `expiresAt` / `createdAt` persistence gap under AUTH-002 authority;
2. bind canonical AUTH-010 DTO/OpenAPI definitions;
3. locate or implement the actual list/revoke runtime surface;
4. bind self-scope authorization and revocation lifecycle;
5. execute integration/security tests and register non-empty Evidence Registry records;
6. only then re-evaluate AUTH-010 for GREEN.
