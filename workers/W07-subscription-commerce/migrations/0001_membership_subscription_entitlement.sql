-- MIG-MEMBERSHIP-D1-01-SUBSCRIPTION-ENTITLEMENT-V1
-- Contract: contracts/persistence/MEMBERSHIP-D1-01-subscription-entitlement-persistence.v1.json

CREATE TABLE IF NOT EXISTS membership_subscriptions (
  subscription_id TEXT NOT NULL PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','PAST_DUE','CANCELED','EXPIRED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
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

CREATE TABLE IF NOT EXISTS membership_mutation_idempotency (
  id TEXT NOT NULL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(owner_user_id, operation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_membership_mutation_idempotency_expiry
  ON membership_mutation_idempotency (expires_at);

CREATE TABLE IF NOT EXISTS membership_txn_guard (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  successful INTEGER NOT NULL CHECK (successful = 1),
  entitlement_changed INTEGER NOT NULL DEFAULT 0 CHECK (entitlement_changed IN (0,1))
);
