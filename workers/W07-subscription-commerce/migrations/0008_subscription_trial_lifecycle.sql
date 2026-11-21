-- D1-01 only: immutable creator trial offer and trial lifecycle metadata.
ALTER TABLE membership_plan_versions
  ADD COLUMN trial_period_days INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(trial_period_days) = 'integer' AND trial_period_days BETWEEN 0 AND 30);

ALTER TABLE membership_subscriptions ADD COLUMN trial_started_at TEXT;
ALTER TABLE membership_subscriptions ADD COLUMN trial_ends_at TEXT;
ALTER TABLE membership_subscriptions ADD COLUMN trial_converted_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_subscriptions_trial_per_subscriber_creator
  ON membership_subscriptions (subscriber_id, creator_id)
  WHERE trial_started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_trial_end
  ON membership_subscriptions (status, trial_ends_at, subscription_id)
  WHERE trial_started_at IS NOT NULL;

-- Trial window timestamps are write-once. Conversion time may be set once
-- from NULL after the first signed successful MIT renewal, but never rewritten.
CREATE TRIGGER IF NOT EXISTS membership_subscriptions_trial_window_immutable
BEFORE UPDATE OF trial_started_at, trial_ends_at ON membership_subscriptions
WHEN OLD.trial_started_at IS NOT NULL AND
  (NEW.trial_started_at IS NOT OLD.trial_started_at OR NEW.trial_ends_at IS NOT OLD.trial_ends_at)
BEGIN
  SELECT RAISE(ABORT, 'subscription trial window is immutable');
END;

CREATE TRIGGER IF NOT EXISTS membership_subscriptions_trial_conversion_write_once
BEFORE UPDATE OF trial_converted_at ON membership_subscriptions
WHEN OLD.trial_converted_at IS NOT NULL AND NEW.trial_converted_at IS NOT OLD.trial_converted_at
BEGIN
  SELECT RAISE(ABORT, 'subscription trial conversion timestamp is immutable');
END;
