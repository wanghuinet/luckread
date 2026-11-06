# AUTH-010 Permission / Self-Scope Reconciliation v1.0

Status: BLOCKED_NOT_GREEN
Implementation / release admission: NOT_ADMITTED

PR #1568 contains a hidden candidate implementation. This reconciliation does not authorize exposing or releasing session management.

## Purpose

Reconcile the canonical AUTH-010 operation policy with the permission catalog and freeze the authorization boundary before runtime implementation.

## Canonical operations

| Operation | Method | Permission | Scope |
|---|---|---|---|
| authSessionList | GET /auth/sessions | user.session.read | self |
| authSessionRevoke | DELETE /auth/sessions/{sessionId} | user.session.revoke | self |

Source: `contracts/api/auth-operation-policy.v1.json`.

## Verified permission catalog state

`contracts/authz/permissions.json` currently contains both canonical permission entries:

- `user.session.read` → resource `user`, action `session_read`, minimum layer `L1`, scope `own`.
- `user.session.revoke` → resource `user`, action `session_revoke`, minimum layer `L1`, scope `own`, audit required.

Both permissions are granted to the global base `user` role in `x-role-permissions.roles`. The permission identifiers are therefore present; the remaining issue is proving that W02 checks the effective assignment and applies the declared self/own scope at runtime.

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

## Candidate runtime enforcement and remaining blockers

The current hidden PR #1568 candidate adds a fail-closed W02 check for both operations:

- W02 derives the subject only from the authenticated Better Auth session; no client-supplied owner/user identifier is accepted.
- The candidate reads the canonical `user` role permission grant from `permissions.json` and requires an effective W02-owned RoleAssignment (`role_id=user`, global scope, null `scope_id`, active status, and valid time window).
- It also requires the account state to remain `PENDING_VERIFICATION` or `ACTIVE`.
- Permission and the bounded session/target query are evaluated in one D1 statement. Missing role assignment or disallowed account state returns `403 PERMISSION_DENIED`.
- The authenticated current session is rejected with `409 CURRENT_SESSION_PROTECTED` before any target-session lookup. Other-account targets remain indistinguishable from missing targets.

These are candidate source changes and tests, not formal admission evidence. The exact-source-SHA W02 unit and controlled local W01/W02 runtime checks must pass before source-level permission behavior can be considered verified.

The following blockers remain:

1. `user.session.revoke` is `auditRequired: true`; the current handler does not yet emit/admit the canonical `user.session.revoked` audit/event record.
2. `authSessionRevoke` policy requires one `session_revocation_projection` async task. W02 currently has no session-revocation queue producer or admitted event/outbox implementation. Do not add a new Queue/Worker; reconcile against the existing W10/Queue architecture first.
3. No exact-current-deployed-SHA remote security E2E is admitted for the current W02 handlers.
4. No authenticated real-account native APP acceptance on both Android and iOS is admitted.
5. `ENT-DEVICE-RECORD` remains PROPOSED; the current API does not provide a stable device identifier. The candidate UI is therefore described as login-session management, not device management.

Until these blockers close:

- AUTH-010 remains NOT_GREEN;
- no permission or security-E2E evidence is promoted to formal PASS;
- the APP entry remains absent and `SESSION_MANAGEMENT_ADMITTED` remains false;
- this PR must not be merged as a release-ready session-management feature.

## Evidence chain

- `contracts/api/auth-operation-policy.v1.json`
- `contracts/authz/permissions.json`
- `contracts/dto/auth-dto-contract.v1.json`
- `contracts/entity/AUTH-002-session-field-contract.v1.json`
- `contracts/alignment/mapping-batches/AUTH-010-session-field-binding.v1.md`
- `contracts/alignment/cross-system-mapping.v1.json`

## Next closure gate

1. Verify the candidate permission checks on the exact current source SHA, including missing/revoked/expired base RoleAssignment and disallowed account-state denial.
2. Reconcile `scope:self` with permission `scope:own` in the canonical mapping and formally bind the W02 handler evidence.
3. Implement/admit the required revocation audit/event/outbox path using the existing architecture and the one-task policy; do not create new Workers, D1 databases or Queues.
4. Pass exact-SHA local W01/W02 runtime and controlled remote/deployed verification.
5. Complete authenticated real-account native APP acceptance on both Android and iOS, then admit the evidence. Only after all gates close may the settings entry be exposed.
