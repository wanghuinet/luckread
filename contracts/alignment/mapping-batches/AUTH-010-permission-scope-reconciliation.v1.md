# AUTH-010 Permission / Self-Scope Reconciliation v1.0

Status: BLOCKED_NOT_GREEN
Implementation authorization: false

## Purpose

Reconcile the canonical AUTH-010 operation policy with the permission catalog and freeze the authorization boundary before runtime implementation.

## Canonical operations

| Operation | Method | Permission | Scope |
|---|---|---|---|
| authSessionList | GET /auth/sessions | user.session.read | self |
| authSessionRevoke | DELETE /auth/sessions/{sessionId} | user.session.revoke | self |

Source: `contracts/api/auth-operation-policy.v1.json`.

## Verified permission catalog state

`contracts/authz/permissions.json` currently contains:

- `user.session.revoke` → resource `user`, action `session_revoke`, minimum layer `L1`, scope `own`, audit required.

The catalog does **not** currently contain `user.session.read`, even though AUTH-010 canonical API policy requires that permission for `authSessionList`.

Therefore the authorization contract is not yet fully reconciled.

## Frozen authorization semantics

### authSessionList

- authentication: required
- subject: current user
- permission: `user.session.read`
- scope: self / own-user only
- resource access must be derived from authenticated subject, never from a client-supplied owner identifier
- cross-account session listing must be denied
- shared cache cannot act as an authorization boundary
- revoked sessions must not be reintroduced through stale cached session data

### authSessionRevoke

- authentication: required
- subject: current user
- permission: `user.session.revoke`
- scope: self / own-user only
- `sessionId` identifies the selected session but does not grant ownership
- server must resolve the session against the authenticated user before mutation
- cross-account revoke must be denied
- repeated revoke is an idempotent successful no-op according to the API policy
- revocation must dominate stale cache state
- audit is required by the existing permission catalog entry

## Important distinction

`scope: self` in the API policy and `scope: own` in the permission catalog represent the same intended ownership boundary for this operation, but the canonical mapping must explicitly document that equivalence rather than silently assuming it.

No new permission identifier is invented in this document. `user.session.read` is referenced only because it already exists as the canonical requirement in the AUTH-010 API operation policy.

## Current blocker

The permission catalog must be reconciled so that `user.session.read` has a canonical catalog entry before AUTH-010 authorization mapping can be considered complete.

Until then:

- no runtime authorization implementation is authorized by this contract;
- no handler may claim permission enforcement evidence;
- no security-E2E evidence may be promoted to PASS;
- AUTH-010 remains NOT_GREEN.

## Evidence chain

- `contracts/api/auth-operation-policy.v1.json`
- `contracts/authz/permissions.json`
- `contracts/dto/auth-dto-contract.v1.json`
- `contracts/entity/AUTH-002-session-field-contract.v1.json`
- `contracts/alignment/mapping-batches/AUTH-010-session-field-binding.v1.md`
- `contracts/alignment/cross-system-mapping.v1.json`

## Next closure gate

1. Add/reconcile the canonical `user.session.read` permission entry in `contracts/authz/permissions.json`.
2. Record the exact catalog binding in the AUTH-010 mapping.
3. Verify `authSessionList` and `authSessionRevoke` against the same self/own ownership predicate.
4. Only after the authorization contract is closed, bind handler authorization evidence.
5. Runtime and Evidence Registry remain closed until executable evidence exists.
