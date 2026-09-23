-- AUTH-013 account-state persistence migration
-- Authority: W02 / D1-01 / ENT-USER
-- Contract: contracts/migration/AUTH-013-account-state-migration.v1.json
-- Scope: admitted only for the currently verified controlled target with users_count = 0.
--
-- The migration intentionally fails closed for a non-empty users table. A future
-- non-empty target requires a separate authoritative backfill policy admission.

CREATE TABLE auth_013_migration_guard_20260923 (
  marker INTEGER NOT NULL
);

CREATE TRIGGER auth_013_migration_guard_20260923_trigger
BEFORE UPDATE ON auth_013_migration_guard_20260923
BEGIN
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM users) <> 0
    THEN RAISE(ABORT, 'AUTH-013 migration requires zero pre-existing users')
  END;
END;

INSERT INTO auth_013_migration_guard_20260923 (marker) VALUES (1);
UPDATE auth_013_migration_guard_20260923 SET marker = marker;

DROP TRIGGER auth_013_migration_guard_20260923_trigger;
DROP TABLE auth_013_migration_guard_20260923;

ALTER TABLE users
  ADD COLUMN account_state TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
  CHECK (
    account_state IN (
      'UNREGISTERED',
      'PENDING_VERIFICATION',
      'ACTIVE',
      'RESTRICTED',
      'FROZEN',
      'SUSPENDED',
      'BANNED',
      'DELETION_REQUESTED',
      'DELETION_PENDING',
      'DELETED',
      'RESTORED',
      'REACTIVATED'
    )
  );

ALTER TABLE users
  ADD COLUMN account_state_version INTEGER NOT NULL DEFAULT 1
  CHECK (account_state_version >= 1);

CREATE INDEX users_account_state_idx
  ON users (account_state);

CREATE INDEX users_account_state_version_idx
  ON users (account_state_version);
