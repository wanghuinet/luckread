# AUTH-015 W02 Lifecycle Window Persistence — Change Control

**Date:** 2026-11-06
**Decision:** AUTHORIZED_SCHEMA_SLICE / REMOTE_MIGRATION_PENDING / NOT_GREEN

## Authorization

The repository owner explicitly authorized in the current conversation the W02 runtime implementation scope for AUTH-015, beginning with trusted lifecycle-window enforcement. This change control admits only the persistence prerequisite: two nullable timestamp columns on the existing W02-owned D1-01 Better Auth user row and a manually gated, exact-source-SHA migration workflow.

This approval is feature-scoped. It does not set B01 implementationAuthorized to true; that batch-wide flag remains false. B01 remains NOT_GREEN, and AUTH-015 remains PARTIAL / NOT_GREEN.

## Verified physical authority

- Worker: W02 (luckread-w02)
- Binding: D1_01
- D1-01: luckread / 2f80471e-3756-49f9-8db1-7707a433ad64
- Target table: Better Auth user
- Existing table creation authority: workers/W02-identity/migrations/0005_better_auth_identity_core.sql

The historical AUTH-013 migration 0002_auth_013_account_state.sql targets Payload's plural users table and is not used for these fields. The AUTH-013 publication journal is not the lifecycle time authority.

## Admitted fields

| Field ID | Column | Type | Nullable | Authority |
|---|---|---|---|---|
| ENT-USER-F-DELETION-REQUESTED-AT | deletion_requested_at | TEXT | Yes | W02 |
| ENT-USER-F-DELETED-AT | deleted_at | TEXT | Yes | W02 |

The columns are nullable because accounts that have never entered deletion do not have a lifecycle timestamp. W02 will write canonical UTC ISO-8601 timestamps only as part of the matching state transition.

## Migration design and fail-closed conditions

Migration: workers/W02-identity/migrations/0011_auth_015_lifecycle_windows.sql.

It performs only: a temporary retry-safe guard check against existing rows; additive ALTER TABLE operations for the two nullable timestamp fields; and removal of the temporary guard table.

There is no backfill, no payload collection mutation, and no lasting new table. The guard rejects any existing row in DELETION_REQUESTED, DELETION_PENDING, DELETED, or REACTIVATED because the historic time required to determine eligibility cannot be reconstructed truthfully. If any such account exists, stop for a separate data-classification decision; do not infer timestamps from created_at, publication journal events, migration dates, or client input.

## Controlled remote migration workflow

The manual-only workflow .github/workflows/auth-015-lifecycle-window-migration.yml requires the operator to enter APPLY. It verifies the exact source SHA, D1-01 name and UUID, current user schema, empty deletion-lifecycle population, absent target columns, and the complete prior W02 migration ledger before applying anything.

The workflow refuses to run if prior W02 migrations are missing or if an unrelated pending migration would also be applied. After applying the migration it verifies both column types/nullability and confirms exactly the expected migration was added to d1_migrations.

**Remote D1 execution status: NOT EXECUTED.** This change control does not claim production schema changes. The workflow artifact must be inspected and bound to the exact tested source SHA before the runtime code is merged or deployed.

## Non-authorizations

This persistence slice does not implement or admit request/cancel deletion APIs (still MISSING); reauthentication, legal hold, unsettled payment/settlement eligibility, or durable request idempotency; the deletion execution job, W10 task contract or any new Queue; anonymization, tombstones, cross-domain deletion, R2, social, content, notification, Feed/Search or cache propagation; banned-account restore end-to-end; public client UI or any new API; AUTH-015/B01/Mapping-0/Evidence-Registry GREEN promotion.

No Worker, D1, Queue, Service Binding or Payload Core surface is added.
