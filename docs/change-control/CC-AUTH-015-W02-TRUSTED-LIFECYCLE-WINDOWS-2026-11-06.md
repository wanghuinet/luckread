# AUTH-015 — W02 Trusted Lifecycle Window Implementation Control

**Date:** 2026-11-06  
**Decision:** `AUTHORIZED_NARROW_RUNTIME_SLICE / NOT_GREEN`

## 1. Authorization and scope

The repository owner explicitly authorized in the current conversation the W02 runtime implementation for AUTH-015, beginning with trusted self-reactivation and deletion lifecycle time-window enforcement.

This control records only the following authorized slice:

- persist the account deletion-request timestamp and completed-deletion timestamp on the existing W02-owned Better Auth `"user"` row in D1-01;
- derive the 15-day cooling-off and 30-day self-reactivation windows from W02 server time and those persisted timestamps;
- atomically commit lifecycle timestamps with the canonical Account State / version update and the existing AUTH-013 publication journal;
- add focused regression, SQLite migration, boundary and fail-closed tests.

This authorization does **not** authorize the full B01 batch or the remaining AUTH-015 workflow. The batch-wide `implementationAuthorized: false` flag is intentionally unchanged; B01 remains `NOT_GREEN`. AUTH-015 remains `PARTIAL / NOT_GREEN` until the complete feature mapping and evidence requirements are satisfied.

## 2. Verified persistence target

The current Better Auth identity migration, `workers/W02-identity/migrations/0005_better_auth_identity_core.sql`, creates the authoritative `"user"` table and includes `account_state` and `account_state_version`.

W02 lifecycle code reads and updates that same `"user"` table through the existing `D1_01` binding. The older AUTH-013 migration `0002_auth_013_account_state.sql` targets the legacy Payload `users` table (plural); it is not the target for these new timestamps.

The AUTH-013 publication journal is only a durable event publication record. Its `occurredAt` value is not lifecycle timestamp authority and is not used to calculate either window.

## 3. Canonical window semantics

### 3.1 Fifteen-day cooling-off

- The start timestamp is set by W02 server time on `ACTIVE -> DELETION_REQUESTED`.
- The same state/version update sets `deletion_requested_at` and clears any stale `deleted_at`.
- A user cancellation is allowed only while `server_now < deletion_requested_at + 15 days`.
- At the exact 15-day boundary, cancellation is denied and `cooling_off_elapsed` is satisfied.
- `DELETION_PENDING -> DELETED` stamps `deleted_at` with W02 server time in the same account-state update.

### 3.2 Thirty-day self-reactivation

- The reactivation window starts at the W02 server timestamp written on `DELETION_PENDING -> DELETED`.
- `DELETED -> REACTIVATED` is allowed only while `server_now < deleted_at + 30 days`, and still requires the target user as actor and the existing `user.reactivate` permission.
- At the exact 30-day boundary, self-reactivation is denied.
- `deleted_at` remains present during `REACTIVATED`; it is cleared when the existing system transition completes `REACTIVATED -> ACTIVE`.

All comparisons use canonical UTC ISO-8601 timestamps and millisecond precision. Missing, malformed, non-canonical, or future timestamps fail closed. Client-provided timestamps or a client-controlled `preconditionSatisfied` boolean are not accepted.

## 4. Migration boundary

New migration: `workers/W02-identity/migrations/0009_auth_015_lifecycle_windows.sql`.

It adds only two nullable `TEXT` columns to the existing `"user"` table:

- `deletion_requested_at`
- `deleted_at`

It performs no backfill and creates no lasting table. A temporary guard rejects a migration target containing existing `DELETION_REQUESTED`, `DELETION_PENDING`, `DELETED`, or `REACTIVATED` rows because their historical timestamps cannot be truthfully reconstructed. Other existing user rows remain unchanged with both new fields NULL. The guard is retry-safe if a failed migration attempt leaves its temporary table behind.

Remote D1-01 mutation is **not** executed by this code change. It requires the separate manual, exact-source-SHA controlled migration workflow and successful post-schema plus `d1_migrations` read-back. No production migration result is claimed in this PR.

## 5. Runtime invariants

1. W02 remains the sole lifecycle timestamp writer and D1-01 account-state authority.
2. W01 remains the public API ingress boundary; no public route or API contract is added here.
3. Timestamp fields and Account State/version are written in the same compare-and-set SQL update; the existing publication journal remains in the same D1 batch.
4. The lifecycle precondition evaluator is derived from canonical state-machine precondition names, not caller-supplied booleans.
5. Unknown preconditions remain fail-closed unless a private W02 service explicitly supplies trusted proof. The email verification path retains its existing W02-only trusted verification signal.
6. No additional Worker, D1, Queue, Service Binding, Workflow runtime, or Payload Core mutation is introduced.

## 6. Tests and evidence

This slice adds/updates tests for:

- setting timestamps from W02 time on the relevant state transitions;
- cancellation one millisecond before the 15-day deadline;
- cancellation rejection at the exact 15-day deadline;
- deletion progression only at/after the 15-day boundary;
- reactivation one millisecond before the 30-day deadline;
- reactivation rejection at the exact 30-day boundary;
- missing, malformed, non-canonical and future timestamps;
- migration success on the existing Better Auth `"user"` table without changing existing active rows;
- migration fail-closed behavior when a deletion lifecycle state has no timestamp provenance;
- TypeScript, authorization and account-state regression CI.

The migration remains pending until the controlled D1-01 workflow is manually executed against the exact source SHA and its schema/ledger artifact is independently inspected. Local SQLite and CI results do not substitute for production D1 evidence.

## 7. Explicit non-goals / remaining AUTH-015 work

This control does not implement or admit:

- the dedicated deletion request and cancellation API operations (both remain `MISSING`);
- reauthentication / step-up;
- legal-hold, unsettled transaction or subscription eligibility checks;
- durable deletion-request idempotency and anti-abuse;
- the W02-owned deletion job progression / W10 async execution contract;
- account credential/session deletion beyond existing state-machine session invalidation;
- anonymization, tombstoning, content/social/notification cleanup, R2 deletion, or Feed/Search/cache convergence;
- administrative banned-account restore end-to-end;
- public APP/H5/PC controls or UI exposure;
- AUTH-015, B01, Mapping 0, Evidence Registry, R4 or Five-Way GREEN promotion.

These remain separate modules with their own explicit ownership, persistence, API, security, test and evidence admission.
