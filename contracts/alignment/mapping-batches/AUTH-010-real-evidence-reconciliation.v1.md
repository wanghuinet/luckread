# AUTH-010 Real Evidence Reconciliation v1

- Feature: `AUTH-010`
- Name: session/device management
- Audit baseline: `61cc62200f63ff81ebccf03e430505722eda7e85`
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

The B01 governance contract also forbids cross-account session/resource access, auth/authorization bypass, direct authoritative state mutation, duplicate business results from replay/retry, and unregistered API fields/permissions/events/features.

## 4. Entity and persistence evidence

Current entity catalog evidence shows `ENT-USER` as the only verified identity entity implementation. `ENT-SESSION` and `ENT-DEVICE-RECORD` remain proposed rather than verified.

The entity-field contract currently has no canonical fields for `ENT-SESSION` or `ENT-DEVICE-RECORD`.

The entity implementation-evidence registry marks these entities as contract-only / not implemented, and the database entity-persistence inventory does not provide verified persistence for them.

Therefore the following are **not established and must not be inferred**:

- Session canonical field IDs
- Device record canonical field IDs
- Session-to-user relation fields
- Session secret/hash persistence fields
- Refresh-token/rotation persistence fields
- Device identity/fingerprint fields
- Session status/revocation fields
- Expiration/created/last-seen fields
- Concrete D1 table/column names
- Payload adapter generated table names

## 5. Runtime/code evidence

Repository searches on the audit baseline did not locate a concrete session-management runtime implementation that can be promoted into Mapping 0 evidence for `authSessionList` or `authSessionRevoke`.

No authoritative handler → DTO → authorization → entity → persistence → lifecycle → event → response chain was found for either operation.

No runtime evidence was found establishing that Payload's internal authentication/session behavior is the canonical implementation of the frozen AUTH-010 contract. Therefore Payload internals are not accepted as evidence by inference.

## 6. Test and evidence gaps

Required production-green evidence is missing for:

- OpenAPI operation definitions for the two session endpoints
- Request/response DTO IDs and schemas
- Entity IDs bound to session/device operations
- Field IDs and persistence mappings
- Session/device lifecycle/state IDs
- Session-related event IDs
- Worker/runtime implementation evidence
- D1 persistence evidence and executed migration evidence
- Self-scope positive/negative authorization tests
- Cross-account access denial tests
- Revocation idempotency tests
- Stale-cache versus authoritative-revocation tests
- Session-list consistency after revocation
- Executed integration/E2E evidence
- Canonical Evidence Registry IDs bound to executed results

The auth operation policy itself records missing OpenAPI, permission, state, cache, anti-abuse, integration and security-E2E evidence for both operations.

## 7. GREEN decision

`AUTH-010 = BLOCKED_NOT_GREEN`.

No code implementation should be authorized from this reconciliation alone.

The feature can only transition to GREEN after the canonical mapping is closed bidirectionally across:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`.

## 8. Next closure work

Closure must establish, without inventing identifiers:

1. Canonical Session and Device entities and their field contracts.
2. Exact persistence/D1 mapping and executable migration evidence.
3. Canonical DTO/OpenAPI definitions for list and revoke.
4. Runtime handler and security-scope implementation evidence.
5. Session/device lifecycle and event bindings.
6. Positive/negative integration and security E2E tests.
7. Non-empty Evidence Registry entries tied to actual execution and commit SHA.
8. Cross-system mapping update from `PARTIAL` to `GREEN` only after every required gate passes.
