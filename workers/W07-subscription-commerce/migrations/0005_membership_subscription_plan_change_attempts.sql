CREATE TABLE IF NOT EXISTS membership_subscription_plan_change_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
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
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING_PAYMENT', 'APPLIED', 'EXPIRED', 'RECONCILIATION_REQUIRED')),
  expires_at TEXT NOT NULL,
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

-- One request key produces one durable attempt per subscriber.
CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_plan_change_attempts_idempotency
  ON membership_subscription_plan_change_attempts (subscriber_id, idempotency_key_hash);

-- Do not allow concurrent unpaid upgrades on the same subscription.
CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_plan_change_attempts_pending_subscription
  ON membership_subscription_plan_change_attempts (subscription_id)
  WHERE status = 'PENDING_PAYMENT';

-- Order IDs are opaque D1-04 references only; no payment facts are duplicated in D1-01.
CREATE INDEX IF NOT EXISTS ix_membership_plan_change_attempts_order_status
  ON membership_subscription_plan_change_attempts (order_id, status);

CREATE INDEX IF NOT EXISTS ix_membership_plan_change_attempts_expiry
  ON membership_subscription_plan_change_attempts (status, expires_at);
