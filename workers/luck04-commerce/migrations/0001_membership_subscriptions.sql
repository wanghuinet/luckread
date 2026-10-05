CREATE TABLE IF NOT EXISTS membership_subscriptions (
  subscription_id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  creator_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  cancel_at TEXT,
  entitlement_snapshot_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_subscriber_status_period
  ON membership_subscriptions (subscriber_id, status, current_period_end);

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_plan_version
  ON membership_subscriptions (plan_id, plan_version);

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_creator_status
  ON membership_subscriptions (creator_id, status);

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_updated_at
  ON membership_subscriptions (updated_at);
