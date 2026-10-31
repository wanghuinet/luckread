-- Period-end scheduled Subscription plan changes.
-- The current Subscription row remains the authority. The schedule receipt is
-- an immutable replay/audit child journal in the same D1-01 database.
ALTER TABLE membership_subscriptions ADD COLUMN pending_plan_id TEXT;
ALTER TABLE membership_subscriptions ADD COLUMN pending_plan_version INTEGER;
ALTER TABLE membership_subscriptions ADD COLUMN pending_plan_effective_at TEXT;
ALTER TABLE membership_subscriptions ADD COLUMN pending_plan_change_id TEXT;

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_pending_plan_effective
  ON membership_subscriptions (pending_plan_effective_at, subscription_id)
  WHERE pending_plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS membership_subscription_scheduled_plan_change_receipts (
  change_request_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(change_request_id) = 64 AND substr(change_request_id, 1, 4) = 'sps_' AND substr(change_request_id, 5) NOT GLOB '*[^0-9a-f]*'),
  subscription_id TEXT NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 256),
  subscriber_id TEXT NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 256),
  source_subscription_version INTEGER NOT NULL
    CHECK (typeof(source_subscription_version) = 'integer' AND source_subscription_version > 0),
  scheduled_subscription_version INTEGER NOT NULL
    CHECK (typeof(scheduled_subscription_version) = 'integer' AND scheduled_subscription_version = source_subscription_version + 1),
  source_plan_id TEXT NOT NULL CHECK (length(source_plan_id) BETWEEN 1 AND 256),
  source_plan_version INTEGER NOT NULL
    CHECK (typeof(source_plan_version) = 'integer' AND source_plan_version > 0),
  target_plan_id TEXT NOT NULL CHECK (length(target_plan_id) BETWEEN 1 AND 256),
  target_plan_version INTEGER NOT NULL
    CHECK (typeof(target_plan_version) = 'integer' AND target_plan_version > 0),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('DOWNGRADE','BILLING_INTERVAL_CHANGE')),
  current_period_start TEXT NOT NULL CHECK (length(current_period_start) BETWEEN 1 AND 64),
  current_period_end TEXT NOT NULL CHECK (length(current_period_end) BETWEEN 1 AND 64 AND current_period_end > current_period_start),
  effective_at TEXT NOT NULL CHECK (effective_at = current_period_end),
  scheduled_at TEXT NOT NULL CHECK (length(scheduled_at) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS ix_membership_subscription_scheduled_plan_changes_subscription
  ON membership_subscription_scheduled_plan_change_receipts (subscription_id, scheduled_at, change_request_id);

CREATE TRIGGER IF NOT EXISTS membership_subscriptions_pending_plan_change_insert_guard
BEFORE INSERT ON membership_subscriptions
WHEN NOT (
  (NEW.pending_plan_id IS NULL AND NEW.pending_plan_version IS NULL AND
   NEW.pending_plan_effective_at IS NULL AND NEW.pending_plan_change_id IS NULL)
  OR
  (NEW.pending_plan_id IS NOT NULL AND NEW.pending_plan_version IS NOT NULL AND
   NEW.pending_plan_effective_at IS NOT NULL AND NEW.pending_plan_change_id IS NOT NULL AND
   NEW.pending_plan_id <> NEW.plan_id AND NEW.pending_plan_effective_at = NEW.current_period_end AND NEW.cancel_at IS NULL AND
   typeof(NEW.pending_plan_version) = 'integer' AND NEW.pending_plan_version > 0 AND
   length(NEW.pending_plan_change_id) = 64 AND substr(NEW.pending_plan_change_id, 1, 4) = 'sps_' AND
   substr(NEW.pending_plan_change_id, 5) NOT GLOB '*[^0-9a-f]*' AND
   EXISTS (
     SELECT 1
     FROM membership_plan_versions source_version
     JOIN membership_plan_versions target_version
       ON target_version.plan_id = NEW.pending_plan_id
      AND target_version.plan_version = NEW.pending_plan_version
     JOIN membership_plans target_plan
       ON target_plan.plan_id = target_version.plan_id
     JOIN membership_subscription_scheduled_plan_change_receipts schedule_receipt
       ON schedule_receipt.change_request_id = NEW.pending_plan_change_id
      AND schedule_receipt.subscription_id = NEW.subscription_id
      AND schedule_receipt.subscriber_id = NEW.subscriber_id
      AND schedule_receipt.source_subscription_version + 1 = NEW.version
      AND schedule_receipt.source_plan_id = NEW.plan_id
      AND schedule_receipt.source_plan_version = NEW.plan_version
      AND schedule_receipt.target_plan_id = NEW.pending_plan_id
      AND schedule_receipt.target_plan_version = NEW.pending_plan_version
      AND schedule_receipt.effective_at = NEW.pending_plan_effective_at
     WHERE source_version.plan_id = NEW.plan_id
       AND source_version.plan_version = NEW.plan_version
       AND target_plan.owner_type = 'CREATOR'
       AND target_plan.owner_id = NEW.creator_id
       AND target_plan.status = 'ACTIVE'
       AND target_plan.visibility = 'PUBLIC'
       AND target_plan.current_version = target_version.plan_version
       AND target_version.currency = source_version.currency
       AND (
         (schedule_receipt.change_kind = 'DOWNGRADE' AND
          target_version.billing_interval = source_version.billing_interval AND
          target_version.price_minor < source_version.price_minor)
         OR
         (schedule_receipt.change_kind = 'BILLING_INTERVAL_CHANGE' AND
          target_version.billing_interval <> source_version.billing_interval)
       )
   )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid scheduled membership plan change');
END;

CREATE TRIGGER IF NOT EXISTS membership_subscriptions_pending_plan_change_update_guard
BEFORE UPDATE OF pending_plan_id, pending_plan_version, pending_plan_effective_at, pending_plan_change_id
ON membership_subscriptions
WHEN NOT (
  (NEW.pending_plan_id IS NULL AND NEW.pending_plan_version IS NULL AND
   NEW.pending_plan_effective_at IS NULL AND NEW.pending_plan_change_id IS NULL)
  OR
  (NEW.pending_plan_id IS NOT NULL AND NEW.pending_plan_version IS NOT NULL AND
   NEW.pending_plan_effective_at IS NOT NULL AND NEW.pending_plan_change_id IS NOT NULL AND
   NEW.pending_plan_id <> NEW.plan_id AND NEW.pending_plan_effective_at = NEW.current_period_end AND NEW.cancel_at IS NULL AND
   typeof(NEW.pending_plan_version) = 'integer' AND NEW.pending_plan_version > 0 AND
   length(NEW.pending_plan_change_id) = 64 AND substr(NEW.pending_plan_change_id, 1, 4) = 'sps_' AND
   substr(NEW.pending_plan_change_id, 5) NOT GLOB '*[^0-9a-f]*' AND
   EXISTS (
     SELECT 1
     FROM membership_plan_versions source_version
     JOIN membership_plan_versions target_version
       ON target_version.plan_id = NEW.pending_plan_id
      AND target_version.plan_version = NEW.pending_plan_version
     JOIN membership_plans target_plan
       ON target_plan.plan_id = target_version.plan_id
     JOIN membership_subscription_scheduled_plan_change_receipts schedule_receipt
       ON schedule_receipt.change_request_id = NEW.pending_plan_change_id
      AND schedule_receipt.subscription_id = NEW.subscription_id
      AND schedule_receipt.subscriber_id = NEW.subscriber_id
      AND schedule_receipt.source_subscription_version + 1 = NEW.version
      AND schedule_receipt.source_plan_id = NEW.plan_id
      AND schedule_receipt.source_plan_version = NEW.plan_version
      AND schedule_receipt.target_plan_id = NEW.pending_plan_id
      AND schedule_receipt.target_plan_version = NEW.pending_plan_version
      AND schedule_receipt.effective_at = NEW.pending_plan_effective_at
     WHERE source_version.plan_id = NEW.plan_id
       AND source_version.plan_version = NEW.plan_version
       AND target_plan.owner_type = 'CREATOR'
       AND target_plan.owner_id = NEW.creator_id
       AND target_plan.status = 'ACTIVE'
       AND target_plan.visibility = 'PUBLIC'
       AND target_plan.current_version = target_version.plan_version
       AND target_version.currency = source_version.currency
       AND (
         (schedule_receipt.change_kind = 'DOWNGRADE' AND
          target_version.billing_interval = source_version.billing_interval AND
          target_version.price_minor < source_version.price_minor)
         OR
         (schedule_receipt.change_kind = 'BILLING_INTERVAL_CHANGE' AND
          target_version.billing_interval <> source_version.billing_interval)
       )
   )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid scheduled membership plan change');
END;

CREATE TRIGGER IF NOT EXISTS membership_subscription_scheduled_plan_change_receipts_immutable_update
BEFORE UPDATE ON membership_subscription_scheduled_plan_change_receipts
BEGIN
  SELECT RAISE(ABORT, 'scheduled subscription plan change receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS membership_subscription_scheduled_plan_change_receipts_immutable_delete
BEFORE DELETE ON membership_subscription_scheduled_plan_change_receipts
BEGIN
  SELECT RAISE(ABORT, 'scheduled subscription plan change receipts are retained');
END;
