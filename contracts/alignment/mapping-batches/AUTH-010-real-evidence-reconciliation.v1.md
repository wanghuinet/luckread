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

## 7. Current session API implementation and runtime evidence (2026-10-10)

PR #991 implements the bounded W01 session-list/revoke surface through the existing W02 Service Binding. The canonical native Better Auth session remains authoritative for session identity and lifecycle; this change does not add Worker/D1/Queue/Service Binding topology, alter the schema, modify Better Auth, or change Payload core.

The exact tested source `51ec6ed8ae8e2bedd0b18fb208135515b801ba5b` passed the controlled local W01 + W02 runtime evidence workflow:

- Workflow run: https://github.com/wanghuinet/luckread/actions/runs/38048910613
- Uploaded evidence artifact: https://github.com/wanghuinet/luckread/actions/runs/38048910613/artifacts/11668427770
- Evidence type: `AUTH-010_SESSION_LIST_REVOKE_W01_W02_LOCAL_RUNTIME`
- Environment: `CONTROLLED_LOCAL_D1`; this is not evidence that the same commit is deployed remotely or in production.
- Verified: signed W02 login cookie authenticates the W01 route; list is capped at 50; cursor continuation works (50 + 6 rows in the fixture); current-session marker is stable; secret fields are absent; list responses are `no-store`; malformed cursor is rejected; a second real W02 identity cannot list the first user's sessions or alter them by revoke; the owner can revoke; repeat revoke is an idempotent 204; the revoked session is absent from a subsequent list; synthetic test identities/sessions are cleaned up; no secrets were captured.

W01 continues to enforce origin/IP guardrails. This PR adds policy-matched scopes inside W02 before any D1 session-row lookup: `authSessionList` consumes account + endpoint keys, and `authSessionRevoke` consumes account + target-session + endpoint keys. The W02 bindings reuse the existing W01 rate-limit namespace IDs (`2026100312` for read at 300 calls/minute and `2026100320` for writes at 60 calls/minute); operation/scope-prefixed keys avoid collisions with W01's existing origin/IP keys. Rate-limit exhaustion returns `429 RATE_LIMITED`; missing or failing bindings fail closed with 503; W01 preserves W02's 429 response instead of converting it to 503. New tests cover the required key scopes, no-D1-on-limit behavior, and W01 status propagation. The canonical `antiAbuse` evidence state remains `MISSING` until this exact source passes CI and the feature-level evidence acceptance process; no Mapping 0 promotion is made. This does not complete the proposed independent device-record feature or promote full AUTH-010 to GREEN.

## 8. Remaining blockers

1. The implementation now includes account + endpoint limits for session listing and account + session + endpoint limits for revocation, applied before the corresponding D1 session-row access. Confirm the new exact-SHA CI result before accepting this item as closed; `antiAbuse` remains `MISSING` until feature-level evidence acceptance. Do not promote repository-wide Mapping 0.
2. The new record `EVD-AUTH010-B11-SESSION-LIST-REVOKE-LOCAL-001` is registered as `CREATED` with the exact workflow/artifact reference. Promote it to `VERIFIED` only through the normal evidence-acceptance process; the repository-wide Mapping 0 registry remains `NOT_GREEN` and its tested-commit anchor is unchanged.
3. Run a new exact-SHA remote/deployed verification before claiming that this PR's session behavior is live in production. The current green run uses controlled local D1 only.
4. Keep the AUTH-002 native-session authority intact. This PR proves the list/revoke runtime path; it does not, by itself, prove every extension-table/device field in the full `ENT-SESSION` contract.
5. `ENT-DEVICE-RECORD` remains proposed. Do not describe this session API closeout as a complete device registry until a separate canonical device contract is established.

The previously listed handler/OpenAPI/self-scope/pagination/revocation test blockers are no longer accurate for the session list/revoke path: canonical OpenAPI, W01/W02 handlers, the controlled runtime evidence, cross-account isolation, revocation persistence, and post-revoke visibility are now present in the tested PR.

## 9. GREEN decision

`AUTH-010 = BLOCKED_NOT_GREEN`.

No promotion to GREEN is made in this pass. The AUTH-002 ↔ AUTH-010 boundary is now explicitly reconciled at the contract level. The previous false blocker concerning duplicate `createdAt` / `expiresAt` extension columns is removed; the remaining blockers are runtime, DTO/OpenAPI, authorization, lifecycle, migration, device-authority, tests and execution evidence.

Required final chain:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`.

## 10. Next closure action

Proceed in this order, one item at a time:

1. verify the exact-source CI for the new account/endpoint/session rate-limit enforcement; if green, treat the implementation gap as closed and proceed to the separate evidence-acceptance step. Keep `antiAbuse` as `MISSING` until evidence is accepted; do not promote Mapping 0;
2. accept `EVD-AUTH010-B11-SESSION-LIST-REVOKE-LOCAL-001` through the feature-level evidence process after applicable mapping gates; its current state is `CREATED`, not active/verified, and repository-wide Mapping 0 must remain `NOT_GREEN`;
3. perform a fresh remote/deployed exact-SHA session lifecycle verification when the code is deployed;
4. revisit AUTH-010's full feature status only after device authority and remaining canonical mapping requirements are genuinely closed.
