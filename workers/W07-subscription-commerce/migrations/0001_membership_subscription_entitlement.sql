-- MIG-MEMBERSHIP-D1-01-SUBSCRIPTION-ENTITLEMENT-V1
-- Contract: contracts/persistence/MEMBERSHIP-D1-01-subscription-entitlement-persistence.v1.json

CREATE TABLE IF NOT EXISTS membership_subscriptions (
  subscription_id TEXT NOT NULL PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','PAST_DUE','CANCELED','EXPIRED')),
  started_at TEXT NOT NULL,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  cancel_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_membership_subscription_subscriber
  ON membership_subscriptions (subscriber_id, created_at);

CREATE INDEX IF NOT EXISTS ix_membership_subscription_plan
  ON membership_subscriptions (plan_id, plan_version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_subscription_active_subscriber_plan
  ON membership_subscriptions (subscriber_id, plan_id)
  WHERE status IN ('PENDING','ACTIVE','PAST_DUE');

CREATE TABLE IF NOT EXISTS membership_entitlement_grants (
  entitlement_id TEXT NOT NULL PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  entitlement_type TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  effective_at TEXT NOT NULL,
  expires_at TEXT,
  source_plan_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_membership_entitlement_subscription
  ON membership_entitlement_grants (subscription_id, effective_at);

CREATE INDEX IF NOT EXISTS ix_membership_entitlement_scope
  ON membership_entitlement_grants (scope_type, scope_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_entitlement_active_scope
  ON membership_entitlement_grants (subscription_id, entitlement_type, scope_type, scope_id)
  WHERE status = 'ACTIVE';
