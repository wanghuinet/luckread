ALTER TABLE membership_subscription_scheduled_plan_changes
  ADD COLUMN change_type TEXT NOT NULL DEFAULT 'DOWNGRADE'
  CHECK (change_type IN ('DOWNGRADE', 'BILLING_INTERVAL_CHANGE'));
