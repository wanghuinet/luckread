-- GENERATED FILE
-- Source authority: contracts/persistence/AUTH-015-account-lifecycle-window-persistence-contract.v1.json
-- Change control: docs/change-control/CC-AUTH-015-W02-LIFECYCLE-WINDOW-PERSISTENCE-2026-11-06.md
-- W02 owns these trusted lifecycle timestamps on the Better Auth "user" row.
-- This is a schema-only PostgreSQL baseline slice; production D1 runtime is unchanged.
-- SQLite canonical UTC ISO-8601 TEXT values are represented as TIMESTAMPTZ.
-- No timestamp backfill, inferred history, default, or data mutation is included.
-- Historical migration 0011 includes a D1-only guard; it is not executed on PostgreSQL.
-- Generator: workers/W02-identity/scripts/neon/generate-auth015-lifecycle-windows-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the canonical contract.

ALTER TABLE "user"
  ADD COLUMN deletion_requested_at TIMESTAMPTZ;

ALTER TABLE "user"
  ADD COLUMN deleted_at TIMESTAMPTZ;
