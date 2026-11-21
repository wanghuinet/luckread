# CC-MAPPING-0-AUTH-015-SELF-DELETION-AUTHORIZATION-RECONCILIATION-2026-11-06

## Status

`STATE_MACHINE_AUTHORITY_ALIGNED / API_RUNTIME_STILL_MISSING / IMPLEMENTATION_NOT_AUTHORIZED`

## 1. Finding

`contracts/api/user-account-operation-policy.v1.json` referenced `account.delete.self` for both:
- `requestAccountDeletion`;
- `cancelAccountDeletion`.

That identifier is not present in `contracts/authz/permissions.json`.

The authoritative `contracts/state-machines/account.json` already expresses the current self-service semantics:
- `ACTIVE -> DELETION_REQUESTED`: `actor=user`, `permission=null`;
- `DELETION_REQUESTED -> ACTIVE`: `actor=user`, `permission=null`, precondition `within_cooling_off`;
- `DELETION_PENDING -> ACTIVE`: `actor=user`, `permission=null`, precondition `within_cooling_off`.

The same policy already uses the explicit marker `per_transition_from_account_state_machine` for `transitionAccountState`.

## 2. Decision

For the two self-service policy entries, use the existing state-machine authorization authority instead of inventing a new RBAC permission:
- `authorization.permission = per_transition_from_account_state_machine`;
- `authorization.authority = contracts/state-machines/account.json`;
- `authorization.enforcement = W02 authorizeAccountStateTransition`;
- retain `scope = self`;
- retain `reauthentication_required`, idempotency, anti-abuse, and the other existing security requirements.

W02 must derive the authenticated subject from the trusted session, verify it equals the target user, and evaluate any transition precondition from authoritative server-side state. The client cannot set actor, permission, approval, or `preconditionSatisfied`.

## 3. Distinct permissioned transitions remain unchanged

- `DELETED -> REACTIVATED` remains self-scoped `user.reactivate`, with `within_reactivation_window`.
- `BANNED -> RESTORED` remains privileged `user.restore` with L7 approval.
- System-owned progression continues to use `system.job`.

The existing catalog entries are reused; no new permission or role grant is added.

## 4. Non-promotion / remaining gaps

This contract alignment does not:
- create or bind the request/cancel OpenAPI routes;
- create request/cancel DTOs or idempotency persistence;
- implement or verify reauthentication/step-up;
- implement the 15-day cooling-off timestamp/deadline or the trusted `within_cooling_off` evaluator;
- implement the 30-day reactivation-window evaluator;
- fix or prove the permissionful self-reactivation runtime branch;
- add entity fields, tables, migrations, Workers, Queues, or bindings;
- promote AUTH-015, B01, Mapping 0, R4, Evidence Registry, or Five-Way.

AUTH-015 remains `BLOCKED_NOT_GREEN`; B01 `implementationAuthorized` remains `false`. Request/cancel operation status remains `MISSING`.

## 5. Non-changes

No runtime source, database, Worker, D1, Queue, API route, or generated registry is changed. No remote operation is executed.
