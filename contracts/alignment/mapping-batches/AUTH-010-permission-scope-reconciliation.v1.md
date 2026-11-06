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
| authLogout | POST /auth/logout | Authenticated session ownership (no role permission) | current session only |

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

## Explicit self/own scope mapping

For these two operations, API policy `scope: self` maps to permission catalog `scope: own` using the same server-derived Better Auth subject predicate:

- subject is derived only from the authenticated current Better Auth session;
- the target session row must have `user_id = current.user.id`;
- no client-supplied owner ID or role label establishes scope;
- the current session itself is not a valid revoke target.

This is a field-level semantic mapping, not a second permission identifier. No new permission is invented.

### authLogout self-termination

- authentication: required via the current Better Auth cookie or Bearer credential
- authorization: the authenticated session itself is the self-scope proof; no RoleAssignment or `user.session.revoke` role gate is evaluated
- account state: no account-state gate is applied to terminating one's own session; a suspended or otherwise restricted account must still be able to log out
- origin / CSRF: before calling `getSession` or writing D1, a Cookie-bearing request must present an Origin/Referer accepted by the same Better Auth `isTrustedOrigin` resolver; missing, null or untrusted browser origins are rejected with 403. Bearer-only native requests do not require a browser Origin, matching Better Auth's cookie-CSRF boundary
- identity: W02 derives both `userId` and `sessionId` from `auth.api.getSession`; no client body, query parameter, or target-session ID is accepted
- mutation: W02 deletes only that exact `(session.id, session.userId)` row and writes the logout audit outbox record in the same D1-01 batch
- replay: a missing/already-revoked current session is a successful no-op and cannot create a second audit event
- browser cookie: W02 invokes Better Auth's sign-out endpoint only after removing the revoked session-token cookie and Bearer header from that internal cleanup request; the request retains other cookies so Better Auth can also expire session-data chunks without a second session deletion
- native Bearer: W02 validates the Bearer credential before deletion; no revoked token is echoed in the response

## Candidate runtime enforcement and remaining blockers

The current hidden PR #1568 candidate adds a fail-closed W02 check for both operations:

- W02 derives the subject only from the authenticated Better Auth session; no client-supplied owner/user identifier is accepted.
- The candidate reads the canonical `user` role permission grant from `permissions.json` and requires an effective W02-owned RoleAssignment (`role_id=user`, global scope, null `scope_id`, active status, and valid time window).
- It also requires the account state to remain `PENDING_VERIFICATION` or `ACTIVE`.
- Permission and the bounded session/target query are evaluated in one D1 statement. Missing role assignment or disallowed account state returns `403 PERMISSION_DENIED`.
- The authenticated current session is rejected with `409 CURRENT_SESSION_PROTECTED` before any target-session lookup. Other-account targets remain indistinguishable from missing targets.

Candidate permission behavior and local runtime evidence are now present on the exact PR source SHA. The hidden implementation also now writes a durable audit event atomically with the authoritative session deletion:

- W02 deletes only the target session owned by the authenticated user and inserts `user.session.revoked` into the new D1-01 `auth_010_session_revocation_journal` in the same D1 batch. The journal insert is conditional on the preceding DELETE changing one row; if the journal write fails, the session deletion transaction fails closed.
- W02's existing scheduled publisher drains that journal with bounded retry/backoff through the already provisioned `AUTH013_QUEUE`; no Queue, Worker, D1 database or Service Binding is added.
- W06 now explicitly dispatches `user.session.revoked` to a dedicated consumer and persists an immutable `AuditEvent` with Session target, authenticated user actor and no session token/device fingerprint/IP/user-agent data.
- The event schema is `contracts/events/AUTH-010-session-revoked-binding.v1.json`; the migration contract is `contracts/migration/AUTH-010-session-revocation-journal.v1.json`.

This closes the source implementation for the permission catalog's `auditRequired` obligation only after the new exact-SHA tests pass; it does not yet prove deployed delivery or formal evidence admission.

The following blockers remain:

1. **Logout audit source path is implemented on this PR branch; exact-SHA CI remains the acceptance gate.** W01 `/auth/logout` now calls the W02 internal self-logout operation. W02 resolves the current Cookie/Bearer session from Better Auth without refreshing it, applies the existing write-rate-limit binding, and atomically deletes only that authenticated session row while inserting an `authLogout / USER_LOGOUT` event in the same D1-01 batch. Missing/already-revoked sessions are no-op success and do not generate a second event. Only after the transaction succeeds does W02 call Better Auth's official sign-out handler with the revoked session-token cookie and Authorization removed, using it solely to expire the configured browser session/session-data cookies; other session-data cookie chunks are retained on the cleanup request so Better Auth can expire them too. The deleted session is not looked up or deleted a second time. W06 validates the operation/reason pairing and records `USER_LOGOUT` as the immutable AuditEvent reason. Browser cookie clearing, native Bearer revocation, no-store responses, and fail-closed D1 behavior have dedicated source tests. The change uses the existing W02 D1-01 session authority, outbox, `AUTH013_QUEUE` and W06 D1-03 consumer; no new Worker, D1, Queue, Service Binding, W04 projection, or Payload Core change is permitted.
2. The new `0012_auth_010_session_revocation_journal.sql` migration has source/contract but no production D1 migration, schema read-back or deployed W02 cron/queue delivery evidence. No production migration was run.
3. No exact-current-deployed-SHA remote security E2E is admitted for the current W01/W02 handlers.
4. No authenticated real-account native APP acceptance on both Android and iOS is admitted.
5. `ENT-DEVICE-RECORD` remains PROPOSED; the current API does not provide a stable device identifier. The candidate UI is therefore described as login-session management, not device management.

Until these blockers close:

- AUTH-010 remains NOT_GREEN;
- no permission or security-E2E evidence is promoted to formal PASS;
- the APP entry remains absent and `SESSION_MANAGEMENT_ADMITTED` remains false;
- this PR must not be merged as a release-ready session-management feature.

## Evidence chain

- `contracts/api/auth-operation-policy.v1.json`
- `contracts/events/AUTH-010-session-revoked-binding.v1.json`
- `contracts/migration/AUTH-010-session-revocation-journal.v1.json`
- `workers/W02-identity/src/auth/session-revocation-events.ts`
- `workers/W02-identity/src/auth/session-revocation-publication-journal.ts`
- `workers/W06-governance/src/session-revocation-audit-queue-consumer.ts`
- `contracts/authz/permissions.json`
- `contracts/dto/auth-dto-contract.v1.json`
- `contracts/entity/AUTH-002-session-field-contract.v1.json`
- `contracts/alignment/mapping-batches/AUTH-010-session-field-binding.v1.md`
- `contracts/alignment/cross-system-mapping.v1.json`

## Next closure gate

1. Pass the new logout source tests and all relevant exact-current-SHA CI checks.
2. Apply migration 0012 only through its controlled, exact-SHA deployment workflow and verify remote D1 schema/ledger read-back.
3. Pass exact-current-SHA remote W01/W02 security E2E and prove live W02 → existing audit queue → W06 AuditEvent delivery for both targeted session revoke and logout.
4. Complete authenticated real-account native APP acceptance on both Android and iOS. Only after all gates close may the settings entry be exposed.
