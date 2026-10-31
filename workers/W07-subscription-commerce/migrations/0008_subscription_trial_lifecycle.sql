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
