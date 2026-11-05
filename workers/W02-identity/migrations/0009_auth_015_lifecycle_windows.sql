-- AUTH-015 server-trusted account lifecycle windows
-- Authority: W02 / D1-01 / Better Auth "user"
-- Contract: contracts/persistence/AUTH-015-account-lifecycle-window-persistence-contract.v1.json
-- Adds only nullable lifecycle timestamps to the existing Better Auth user table.
-- Existing deletion lifecycle rows without timestamp provenance must block this migration.
-- No user data is backfilled and no other table/Worker/Queue/Binding is created.

CREATE TABLE auth_015_migration_guard_20261106 (
  marker INTEGER NOT NULL CHECK (marker = 1)
);

INSERT INTO auth_015_migration_guard_20261106 (marker)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM "user"
    WHERE account_state IN (
      'DELETION_REQUESTED',
      'DELETION_PENDING',
      'DELETED',
      'REACTIVATED'
    )
  ) THEN 0
  ELSE 1
END;

DROP TABLE auth_015_migration_guard_20261106;

ALTER TABLE "user"
  ADD COLUMN deletion_requested_at TEXT;

ALTER TABLE "user"
  ADD COLUMN deleted_at TEXT;
