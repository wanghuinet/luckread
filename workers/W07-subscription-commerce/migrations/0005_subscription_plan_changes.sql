-- Scheduled membership-plan changes remain D1-01 Subscription authority.
-- They are applied only in the same D1-01 subscription update that follows
-- a verified successful D1-04 renewal payment. This migration creates no new
-- Worker, database, Queue, or Service Binding.

CREATE TABLE membership_subscription_plan_changes (
  change_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(change_id) = 30 AND substr(change_id, 1, 4) = 'spc_' AND substr(change_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  subscription_id TEXT NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 256),
  subscriber_id TEXT NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 256),
  source_plan_id TEXT NOT NULL CHECK (length(source_plan_id) BETWEEN 1 AND 256),
  source_plan_version INTEGER NOT NULL CHECK (typeof(source_plan_version) = 'integer' AND source_plan_version >= 1),
  target_plan_id TEXT NOT NULL CHECK (length(target_plan_id) BETWEEN 1 AND 256),
  target_plan_version INTEGER NOT NULL CHECK (typeof(target_plan_version) = 'integer' AND target_plan_version >= 1),
  change_type TEXT NOT NULL CHECK (change_type IN ('DOWNGRADE','BILLING_INTERVAL_CHANGE','SAME_PRICE_CHANGE')),
  effective_at TEXT NOT NULL CHECK (length(effective_at) BETWEEN 1 AND 64),
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED','APPLIED','CANCELED')),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  CHECK (source_plan_id <> target_plan_id OR source_plan_version <> target_plan_version),
  FOREIGN KEY (subscription_id) REFERENCES membership_subscriptions(subscription_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_plan_id, source_plan_version) REFERENCES membership_plan_versions(plan_id, plan_version) ON DELETE RESTRICT,
  FOREIGN KEY (target_plan_id, target_plan_version) REFERENCES membership_plan_versions(plan_id, plan_version) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX ux_membership_subscription_plan_changes_one_scheduled
  ON membership_subscription_plan_changes(subscription_id)
  WHERE status = 'SCHEDULED';

CREATE INDEX ix_membership_subscription_plan_changes_subscriber_created
  ON membership_subscription_plan_changes(subscriber_id, created_at, change_id);

CREATE INDEX ix_membership_subscription_plan_changes_effective
  ON membership_subscription_plan_changes(status, effective_at, subscription_id);

CREATE TRIGGER membership_subscription_plan_changes_identity_immutable
BEFORE UPDATE OF change_id, subscription_id, subscriber_id, source_plan_id, source_plan_version,
  target_plan_id, target_plan_version, change_type, effective_at, request_hash, created_at
ON membership_subscription_plan_changes
WHEN NEW.change_id IS NOT OLD.change_id
  OR NEW.subscription_id IS NOT OLD.subscription_id
  OR NEW.subscriber_id IS NOT OLD.subscriber_id
  OR NEW.source_plan_id IS NOT OLD.source_plan_id
  OR NEW.source_plan_version IS NOT OLD.source_plan_version
  OR NEW.target_plan_id IS NOT OLD.target_plan_id
  OR NEW.target_plan_version IS NOT OLD.target_plan_version
  OR NEW.change_type IS NOT OLD.change_type
  OR NEW.effective_at IS NOT OLD.effective_at
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'scheduled subscription plan-change identity is immutable'); END;

CREATE TRIGGER membership_subscription_plan_changes_version_guard
BEFORE UPDATE ON membership_subscription_plan_changes
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'scheduled subscription plan change requires version CAS and increasing updated_at'); END;

CREATE TRIGGER membership_subscription_plan_changes_state_transition_guard
BEFORE UPDATE OF status ON membership_subscription_plan_changes
WHEN NOT (OLD.status = 'SCHEDULED' AND NEW.status IN ('APPLIED','CANCELED'))
BEGIN SELECT RAISE(ABORT, 'scheduled subscription plan change has an invalid state transition'); END;

CREATE TRIGGER membership_subscription_plan_changes_applied_guard
BEFORE UPDATE OF status ON membership_subscription_plan_changes
WHEN NEW.status = 'APPLIED' AND NOT EXISTS (
  SELECT 1 FROM membership_subscriptions s
  WHERE s.subscription_id = NEW.subscription_id
    AND s.subscriber_id = NEW.subscriber_id
    AND s.plan_id = NEW.target_plan_id
    AND s.plan_version = NEW.target_plan_version
    AND s.current_period_start >= NEW.effective_at
)
BEGIN SELECT RAISE(ABORT, 'plan change is applied only after the paid subscription period advances to the target plan'); END;

-- A plan switch in D1-01 can only be marked applied after the same authoritative
-- Subscription update has moved to the scheduled target at/after the effective
-- period boundary. The update and audit-row transition are one SQLite transaction.
CREATE TRIGGER membership_subscription_plan_changes_mark_applied
AFTER UPDATE OF plan_id, plan_version ON membership_subscriptions
WHEN NEW.plan_id <> OLD.plan_id OR NEW.plan_version <> OLD.plan_version
BEGIN
  UPDATE membership_subscription_plan_changes
  SET status = 'APPLIED', version = version + 1, updated_at = NEW.updated_at
  WHERE subscription_id = NEW.subscription_id
    AND subscriber_id = NEW.subscriber_id
    AND source_plan_id = OLD.plan_id
    AND source_plan_version = OLD.plan_version
    AND target_plan_id = NEW.plan_id
    AND target_plan_version = NEW.plan_version
    AND status = 'SCHEDULED'
    AND effective_at <= NEW.current_period_start;
END;

CREATE TRIGGER membership_subscription_plan_changes_retained
BEFORE DELETE ON membership_subscription_plan_changes
BEGIN SELECT RAISE(ABORT, 'subscription plan-change history is retained'); END;
