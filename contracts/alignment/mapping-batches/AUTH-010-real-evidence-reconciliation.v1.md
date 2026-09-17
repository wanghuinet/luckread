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

## 4. Newly confirmed persistence/code evidence

Repository inspection now confirms concrete session extension schema code exists in `src/db/auth-session-state.ts` and is registered in `src/payload.config.ts` as the `auth_session_state` raw table/schema.

Confirmed fields are:

- `session_id` — primary key
- `user_id`
- `device_id`
- `token_version`
- `refresh_credential_hash`
- `revoked_at`
- `last_seen_at`

Confirmed indexes exist for user, device, token version and revoked-at fields.

The persistence contract `AUTH-002-minimum-session-extension-persistence-contract.v1.1.json` defines `ENT-SESSION`, the native Payload `users.sessions[]` relationship, the same extension fields, and fail-closed/session lifecycle rules. However, that contract is explicitly `CONTRACTED_NOT_VERIFIED`; migration/runtime/test/evidence readiness remains open.

## 5. Important boundary

The discovered `auth_session_state` code is evidence of a persistence/schema implementation, but it is **not** evidence that AUTH-010 list/revoke endpoints are implemented.

The source file comments identify this table as the minimal extension state for AUTH-002. Therefore AUTH-010 must not claim ownership of this table merely from name/field similarity. Cross-feature authority must be explicitly reconciled before promotion.

Repository search still found no concrete handler implementing both `authSessionList` and `authSessionRevoke`, and no authoritative handler → DTO → authorization → persistence → lifecycle → response chain for AUTH-010.

## 6. Remaining blockers

1. Bind canonical Session/Device entity and field IDs to AUTH-010 without duplicating or overriding AUTH-002 authority.
2. Prove whether AUTH-010 consumes the existing AUTH-002 session state contract or requires a distinct contract extension.
3. Establish canonical DTO/OpenAPI definitions for list/revoke.
4. Establish runtime handler and self-scope authorization evidence.
5. Establish lifecycle/event semantics for list/revoke and authoritative revocation.
6. Prove executable migration/application state; schema source code alone is insufficient.
7. Add positive/negative integration/security tests and actual Evidence Registry references.

## 7. GREEN decision

`AUTH-010 = BLOCKED_NOT_GREEN`.

No promotion to GREEN is made in this pass. The new persistence evidence reduces an evidence gap but does not close the five-way/runtime/security/test chain.

Required final chain:

`Feature → Capability → API → DTO → Entity → Field/Persistence → Payload → Code/Worker → Security → Lifecycle → Test → Evidence`.

## 8. Next closure action

Continue with the canonical AUTH-002 ↔ AUTH-010 boundary reconciliation first, then bind the actual list/revoke API/runtime surface. Only after executed evidence exists should the cross-system mapping status change.
