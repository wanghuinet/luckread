-- Immutable application receipt for paid Subscription plan changes.
-- This is a bounded child journal of the existing ENT-SUBSCRIPTION aggregate,
-- not a new Worker, database or cross-D1 transaction. The D1-01 subscription
-- CAS and receipt insert execute in one D1 batch transaction.
CREATE TABLE IF NOT EXISTS membership_subscription_plan_change_receipts (
  change_request_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(change_request_id) = 64 AND substr(change_request_id, 1, 4) = 'scr_' AND substr(change_request_id, 5) NOT GLOB '*[^0-9a-f]*'),
  subscription_id TEXT NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 256),
  subscriber_id TEXT NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 256),
  source_subscription_version INTEGER NOT NULL
    CHECK (typeof(source_subscription_version) = 'integer' AND source_subscription_version > 0),
  applied_subscription_version INTEGER NOT NULL
    CHECK (typeof(applied_subscription_version) = 'integer' AND applied_subscription_version = source_subscription_version + 1),
  source_plan_id TEXT NOT NULL CHECK (length(source_plan_id) BETWEEN 1 AND 256),
  source_plan_version INTEGER NOT NULL
    CHECK (typeof(source_plan_version) = 'integer' AND source_plan_version > 0),
  target_plan_id TEXT NOT NULL CHECK (length(target_plan_id) BETWEEN 1 AND 256),
  target_plan_version INTEGER NOT NULL
    CHECK (typeof(target_plan_version) = 'integer' AND target_plan_version > 0),
  order_id TEXT NOT NULL CHECK (length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT NOT NULL
    CHECK (length(payment_id) = 30 AND substr(payment_id, 1, 4) = 'pay_' AND substr(payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  amount_before_tax_minor INTEGER NOT NULL
    CHECK (typeof(amount_before_tax_minor) = 'integer' AND amount_before_tax_minor > 0),
  current_period_start TEXT NOT NULL CHECK (length(current_period_start) BETWEEN 1 AND 64),
  current_period_end TEXT NOT NULL CHECK (length(current_period_end) BETWEEN 1 AND 64 AND current_period_end > current_period_start),
  applied_at TEXT NOT NULL CHECK (length(applied_at) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS ix_membership_subscription_plan_change_receipts_subscription
  ON membership_subscription_plan_change_receipts (subscription_id, applied_at, change_request_id);

CREATE INDEX IF NOT EXISTS ix_membership_subscription_plan_change_receipts_payment
  ON membership_subscription_plan_change_receipts (payment_id);

CREATE TRIGGER IF NOT EXISTS membership_subscription_plan_change_receipts_immutable_update
BEFORE UPDATE ON membership_subscription_plan_change_receipts
BEGIN
  SELECT RAISE(ABORT, 'subscription plan change receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS membership_subscription_plan_change_receipts_immutable_delete
BEFORE DELETE ON membership_subscription_plan_change_receipts
BEGIN
  SELECT RAISE(ABORT, 'subscription plan change receipts are retained');
END;
