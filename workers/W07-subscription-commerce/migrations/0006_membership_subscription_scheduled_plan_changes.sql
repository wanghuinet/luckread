CREATE TABLE IF NOT EXISTS membership_subscription_scheduled_plan_changes (
  change_id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  expected_subscription_version INTEGER NOT NULL
    CHECK (typeof(expected_subscription_version) = 'integer' AND expected_subscription_version > 0),
  expected_plan_id TEXT NOT NULL,
  expected_plan_version INTEGER NOT NULL
    CHECK (typeof(expected_plan_version) = 'integer' AND expected_plan_version > 0),
  target_plan_id TEXT NOT NULL,
  target_plan_version INTEGER NOT NULL
    CHECK (typeof(target_plan_version) = 'integer' AND target_plan_version > 0),
  effective_at TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('SCHEDULED', 'APPLIED', 'CANCELLED', 'RECONCILIATION_REQUIRED')),
  applied_at TEXT,
  applied_subscription_version INTEGER
    CHECK (applied_subscription_version IS NULL OR
      (typeof(applied_subscription_version) = 'integer' AND applied_subscription_version > 0)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(version) = 'integer' AND version > 0),
  CHECK (
    (status = 'APPLIED' AND applied_at IS NOT NULL AND applied_subscription_version IS NOT NULL)
    OR
    (status <> 'APPLIED' AND applied_at IS NULL AND applied_subscription_version IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_scheduled_plan_changes_idempotency
  ON membership_subscription_scheduled_plan_changes (subscriber_id, idempotency_key_hash);

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_scheduled_plan_changes_pending_subscription
  ON membership_subscription_scheduled_plan_changes (subscription_id)
  WHERE status = 'SCHEDULED';

CREATE INDEX IF NOT EXISTS ix_membership_scheduled_plan_changes_effective
  ON membership_subscription_scheduled_plan_changes (status, effective_at, subscription_id);
