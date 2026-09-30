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

The canonical Session field contract defines nine fields:

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

## 5. Corrected persistence boundary

The prior reconciliation wording incorrectly treated `expiresAt` and `createdAt` as missing persistence fields. That is **not the canonical architecture** and must not be used as a blocker.

The AUTH-002 native-session decision explicitly establishes that Payload v3.87.1 `UserSession` contains `id`, `createdAt`, and `expiresAt`, and that native `users.sessions[]` remains authoritative for those native dimensions. The AUTH-002 extension table is intentionally limited to dimensions not represented by the native Payload session shape. fileciteturn46file0

Therefore the correct persistence boundary is:

| Canonical field | Physical authority | Current evidence state |
|---|---|---|
| `id` | Payload native `users.sessions[].id` | Contract/source evidence; runtime correlation not executed |
| `createdAt` | Payload native `users.sessions[].createdAt` | Contract/source evidence; runtime/schema capture not accepted |
| `expiresAt` | Payload native `users.sessions[].expiresAt` | Contract/source evidence; runtime/schema capture not accepted |
| `userId` | User/session relationship + AUTH-002 extension linkage | Static/schema evidence; runtime correlation not accepted |
| `deviceId` | `auth_session_state.device_id` | Static/schema evidence; runtime binding not accepted |
| `tokenVersion` | `auth_session_state.token_version` | Static/schema evidence; runtime binding not accepted |
| `refreshCredentialHash` | `auth_session_state.refresh_credential_hash` | Static/schema evidence; runtime/security evidence not accepted |
| `revokedAt` | `auth_session_state.revoked_at` | Static/schema evidence; authoritative lifecycle evidence not accepted |
| `lastSeenAt` | `auth_session_state.last_seen_at` | Static/schema evidence; runtime update evidence not accepted |

`auth_session_state` therefore must **not** add duplicate `created_at` or `expires_at` columns merely to satisfy the canonical field list. Its source code explicitly states that native Payload session identity, creation timestamp, and expiry remain canonical. fileciteturn43file0

Confirmed extension implementation fields are:

- `session_id` — primary key
- `user_id`
- `device_id`
- `token_version`
- `refresh_credential_hash`
- `revoked_at`
- `last_seen_at`

Confirmed indexes exist for user, device, token version and revoked-at fields.

The persistence contract likewise identifies native `users.sessions[]` as the owner of `id`, `createdAt`, and `expiresAt`. fileciteturn45file1

## 6. Device authority boundary

`ENT-DEVICE-RECORD` is still `PROPOSED` with no canonical field contract. Therefore the word `device` in AUTH-010's feature scope cannot yet be promoted into an independent entity mapping.

For the current closure pass, `deviceId` is treated only as the canonical `ENT-SESSION-F-DEVICE-ID` relation required by AUTH-002. AUTH-010 must not invent an `ENT-DEVICE-RECORD` schema, fields, collection, or runtime authority to fill this gap.

A separate device contract is required before AUTH-010 can claim a fully reconciled device registry surface.

## 7. Important runtime boundary

The discovered `auth_session_state` code is evidence of a persistence/schema implementation, but it is **not** evidence that AUTH-010 list/revoke endpoints are implemented.

The source file comments identify this table as the minimal extension state for AUTH-002. Therefore AUTH-010 must consume that authority through an explicit runtime binding rather than claim ownership from name/field similarity. fileciteturn43file0

Repository search still found no concrete handler implementing both `authSessionList` and `authSessionRevoke`, and no authoritative handler → DTO → authorization → persistence → lifecycle → response chain for AUTH-010.

## 8. Remaining blockers

1. Bind `authSessionList` and `authSessionRevoke` to the canonical `ENT-SESSION` entity/field IDs without duplicating or overriding AUTH-002 authority.
2. Accept real Gate-1 schema evidence proving the native `createdAt` / `expiresAt` representation and extension schema against the tested commit; no duplicate extension columns should be introduced.
3. Establish canonical DTO/OpenAPI request/response definitions for list/revoke.
4. Establish concrete runtime handlers and self-scope authorization evidence.
5. Establish authoritative lifecycle/event semantics for list/revoke, including revocation dominance over stale cache.
6. Prove executable migration/application state for the extension schema and its relationship to native session persistence.
7. Define and validate `ENT-DEVICE-RECORD` separately before claiming complete device-registry mapping.
8. Add positive/negative integration/security tests and actual Evidence Registry execution references.

## 9. GREEN decision

`AUTH-010 = BLOCKED_NOT_GREEN`.

No promotion to GREEN is made in this pass. The AUTH-002 ↔ AUTH-010 boundary is now explicitly reconciled at the contract level. The previous false blocker concerning duplicate `createdAt` / `expiresAt` extension columns is removed; the remaining blockers are runtime, DTO/OpenAPI, authorization, lifecycle, migration, device-authority, tests and execution evidence.

Required final chain:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`.

## 10. Next closure action

Proceed in this order:

1. execute/accept AUTH-002 Gate-1 schema evidence for the native + extension boundary;
2. bind canonical AUTH-010 DTO/OpenAPI definitions;
3. locate or implement the actual list/revoke runtime surface;
4. bind self-scope authorization and revocation lifecycle;
5. execute integration/security tests and register non-empty Evidence Registry records;
6. only then re-evaluate AUTH-010 for GREEN.
