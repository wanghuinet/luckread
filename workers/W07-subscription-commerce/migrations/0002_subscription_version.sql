-- Subscription authoritative concurrency version migration
-- Authority: W07 / D1-01 / ENT-SUBSCRIPTION
-- Contract: contracts/migration/SUBSCRIPTION-version-migration.v1.json
-- Controlled zero-row target only; fail closed for non-empty target.

CREATE TABLE subscription_version_migration_guard_20261003 (
  marker INTEGER NOT NULL CHECK (marker = 1)
);

INSERT INTO subscription_version_migration_guard_20261003 (marker)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM membership_subscriptions) = 0 THEN 1
  ELSE 0
END;

DROP TABLE subscription_version_migration_guard_20261003;

ALTER TABLE membership_subscriptions
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version >= 1);
