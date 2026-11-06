# CC-AUTH-010-SESSION-AUDIT-ONLY-NO-PROJECTION-2026-11-06

## Status

`ADMITTED_FOR_IMPLEMENTATION`

## Decision

The canonical asynchronous side effect for session revocation is an immutable W06 audit event delivered through the already provisioned W02 `AUTH013_QUEUE`. It is not a derived W04 session-state projection.

Set the `queue.taskType` for both `authLogout` and `authSessionRevoke` in `contracts/api/auth-operation-policy.v1.json` to `session_revocation_audit`.

## Rationale

- W02 D1-01 Better Auth `session` is the single authoritative session-state store.
- W02 session list and authentication checks read the authoritative Better Auth session state directly.
- W01 session read responses are `Cache-Control: no-store`; there is no separate session-state projection or authorization cache that needs asynchronous invalidation.
- The session revoke handler deletes the authoritative Better Auth row and writes a durable audit intent in the same D1-01 batch.
- W02's existing scheduled publisher sends that audit intent to the existing `AUTH013_QUEUE`; W06 consumes it and persists the canonical immutable `AuditEvent` in D1-03.
- The existing W04 projection queue and consumer are specifically contracted for `identity.account_state_changed`. Session events must not be sent there.

A session-state projection would duplicate authoritative state without a valid destination or consumer. The old `session_revocation_projection` task label is therefore a stale contract designation, not a requirement to add a second session authority.

## Scope

This change corrects the semantic task designation only. It does not claim the logout operation is already audited:

- `authSessionRevoke` has the W02 atomic DELETE + outbox + W06 audit source implementation.
- W01 `/auth/logout` still delegates to Better Auth `/sign-out` and must be wired to the same audited W02 current-session deletion path before complete logout audit can be claimed.

## Frozen architecture constraints

- No new Worker, D1 database, Queue, Service Binding, or session authority.
- No W04 consumer changes and no session event is sent to the W04 projection queue.
- No Payload Core changes.
- W02 remains identity/session authority; W06 remains audit authority.
- The W06 audit queue is not a session-state projection.
- This change does not imply production migration, deployment, remote delivery, security E2E, device identity, AUTH-010 GREEN, or permission to expose the APP setting.

## Acceptance

- Both canonical operation-policy entries identify `session_revocation_audit`.
- The AUTH-010 event contract states that no separate session-state projection is required.
- The AUTH-010 reconciliation identifies logout auditing as the remaining source-code gap.
- Contract Admission and relevant exact-SHA CI checks pass.
