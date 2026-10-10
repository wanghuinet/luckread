# Change Control — W01 Better Auth Profile Projection Migration — 2026-10-10

- ID: CC-W01-BETTER-AUTH-PROFILE-PROJECTION-MIGRATION-2026-10-10
- Date: 2026-10-10
- Status: GREEN — EXECUTION ADMITTED THROUGH THE MANUAL CONTROLLED WORKFLOW ONLY
- Scope: Register and execute only the existing additive migration that adds nullable users.identity_id plus its unique index.

## Verified production evidence

The read-only evidence package from GitHub Actions run 38030608717 was captured against:
- Repository source SHA: 1c510ba74f16050286fef5ebc185403f17f7d959
- Database name: luckread
- Database ID: 2f80471e-3756-49f9-8db1-7707a433ad64
- Binding: W01 D1 / W02 D1-01
- Execution mode: CONTROLLED_REMOTE_D1_READONLY
- DDL/DML: none

The captured production users table contains the existing Payload auth/profile columns and canonical profile fields including username, display_name, bio, avatar, locale, and timezone. It does not contain identity_id. The Better Auth profile projection migration source exists in the repository, but the Payload migrations index does not register it.

W01 registration creates the W02 identity first and then creates a Payload user profile projection with identityId. This missing production column is consistent with the observed profile-projection failure and 503 response. No production registration is considered repaired until the controlled migration postcheck and a real registration runtime test both pass.

## Admitted migration source

- Migration: workers/W01-payload/src/migrations/20261006_202000_MIG_BETTER_AUTH_PROFILE_PROJECTION_V1.ts
- Migration blob: 5a6da5828534eca31a2e9e800692badc4096fecc
- Change: register the existing migration exactly once in workers/W01-payload/src/migrations/index.ts.
- Schema change: add nullable text column users.identity_id and unique index users_identity_id_idx.
- Existing user rows are preserved. No identity backfill is performed by this change.

## Execution boundary

Remote execution is permitted only through:
.github/workflows/w01-better-auth-profile-projection-migration.yml

Required manual inputs:
- source_sha: exact main commit containing this change control, registered migration and workflow.
- database_name: luckread.
- confirm: APPLY_BETTER_AUTH_PROFILE_PROJECTION_MIGRATION.

The workflow fails closed before mutation unless:
- the requested source SHA matches the checked-out commit;
- the exact admitted migration file blob is present and the migration is registered exactly once;
- the W01 D1 binding names database luckread and its ID equals 2f80471e-3756-49f9-8db1-7707a433ad64;
- the remote database info proves the same database ID;
- users has the expected baseline columns, identity_id is absent, and users_identity_id_idx is absent;
- the users row count can be read;
- the Payload migration history contains exactly the six previously admitted migrations and no other pending or unknown state.

The workflow then invokes Payload's migration runner, followed by a remote schema/history postcheck. It records the before/after users row counts and fails if they differ. Its execution artifact contains the captured preflight, postcheck, and provenance. If any precondition differs, stop and reconcile evidence; do not force the migration or use a generic application deployment to mutate D1.

## Post-execution acceptance

All of the following are required:
- users.identity_id exists as nullable text;
- users_identity_id_idx exists and is unique;
- the target migration is recorded exactly once in payload_migrations;
- the users row count is unchanged;
- execution provenance identifies the exact source SHA and controlled D1 database;
- registration is tested end-to-end and W01/W02 runtime logs show no AUTH001_PROFILE_PROJECTION_FAILURE.

## Non-actions and rollback boundary

- No Better Auth core modification.
- No Payload core modification.
- No new Worker, D1, Queue, session store, or account authority.
- No manual DDL or data backfill.
- No attempt to delete or recreate existing users.
- Do not roll back this migration after registrations begin using identity_id; rollback would drop the projection key and requires a separately reviewed recovery plan.
