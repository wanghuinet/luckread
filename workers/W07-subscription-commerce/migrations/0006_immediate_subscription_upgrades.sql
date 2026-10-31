-- Immediate upgrades are applied only after W07 has verified and durably
-- reconciled a successful Hyperswitch payment in D1-04. D1-01 stores the
-- entitlement-plan transition evidence and remains the subscription authority.

CREATE TABLE membership_subscription_plan_change_applications (
  application_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(application_id) = 30 AND substr(application_id, 1, 4) = 'spa_' AND substr(application_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  subscription_id TEXT NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 256),
  subscriber_id TEXT NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 256),
  source_plan_id TEXT NOT NULL CHECK (length(source_plan_id) BETWEEN 1 AND 256),
  source_plan_version INTEGER NOT NULL CHECK (typeof(source_plan_version) = 'integer' AND source_plan_version >= 1),
  target_plan_id TEXT NOT NULL CHECK (length(target_plan_id) BETWEEN 1 AND 256),
  target_plan_version INTEGER NOT NULL CHECK (typeof(target_plan_version) = 'integer' AND target_plan_version >= 1),
  expected_subscription_version INTEGER NOT NULL CHECK (typeof(expected_subscription_version) = 'integer' AND expected_subscription_version >= 1),
  current_period_start TEXT NOT NULL CHECK (length(current_period_start) BETWEEN 1 AND 64),
  current_period_end TEXT NOT NULL CHECK (length(current_period_end) BETWEEN 1 AND 64 AND current_period_end > current_period_start),
  order_id TEXT NOT NULL CHECK (length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT CHECK (payment_id IS NULL OR (length(payment_id) = 30 AND substr(payment_id, 1, 4) = 'pay_' AND substr(payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*')),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  status TEXT NOT NULL CHECK (status IN ('PENDING_PAYMENT','READY','APPLIED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  FOREIGN KEY (subscription_id) REFERENCES membership_subscriptions(subscription_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_plan_id, source_plan_version) REFERENCES membership_plan_versions(plan_id, plan_version) ON DELETE RESTRICT,
  FOREIGN KEY (target_plan_id, target_plan_version) REFERENCES membership_plan_versions(plan_id, plan_version) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX ux_membership_plan_change_applications_order
  ON membership_subscription_plan_change_applications(order_id);
CREATE UNIQUE INDEX ux_membership_plan_change_applications_payment
  ON membership_subscription_plan_change_applications(payment_id);
CREATE UNIQUE INDEX ux_membership_plan_change_applications_ready_subscription
  ON membership_subscription_plan_change_applications(subscription_id)
  WHERE status IN ('PENDING_PAYMENT','READY');
CREATE INDEX ix_membership_plan_change_applications_subscriber_created
  ON membership_subscription_plan_change_applications(subscriber_id, created_at, application_id);

CREATE TRIGGER membership_subscription_plan_change_applications_insert_guard
BEFORE INSERT ON membership_subscription_plan_change_applications
WHEN NOT EXISTS (
  SELECT 1
  FROM membership_subscriptions s
  INNER JOIN membership_plans sp ON sp.plan_id = NEW.source_plan_id
  INNER JOIN membership_plan_versions sv ON sv.plan_id = sp.plan_id AND sv.plan_version = NEW.source_plan_version
  INNER JOIN membership_plans tp ON tp.plan_id = NEW.target_plan_id
  INNER JOIN membership_plan_versions tv ON tv.plan_id = tp.plan_id AND tv.plan_version = NEW.target_plan_version
  WHERE NEW.status = 'PENDING_PAYMENT'
    AND NEW.payment_id IS NULL
    AND s.subscription_id = NEW.subscription_id
    AND s.subscriber_id = NEW.subscriber_id
    AND s.plan_id = NEW.source_plan_id
    AND s.plan_version = NEW.source_plan_version
    AND s.status = 'ACTIVE'
    AND s.cancel_at IS NULL
    AND s.version = NEW.expected_subscription_version
    AND s.current_period_start = NEW.current_period_start
    AND s.current_period_end = NEW.current_period_end
    AND NOT EXISTS (
      SELECT 1 FROM membership_subscription_plan_changes pc
      WHERE pc.subscription_id = NEW.subscription_id AND pc.status = 'SCHEDULED'
    )
    AND NEW.created_at >= s.current_period_start
    AND NEW.created_at < s.current_period_end
    AND sp.owner_type = 'CREATOR'
    AND tp.owner_type = 'CREATOR'
    AND sp.owner_id = tp.owner_id
    AND sv.billing_interval = tv.billing_interval
    AND sv.currency = tv.currency
    AND tv.price_minor > sv.price_minor
)
BEGIN SELECT RAISE(ABORT, 'paid upgrade application does not match the current subscription and immutable plans'); END;

CREATE TRIGGER membership_subscription_plan_change_applications_identity_immutable
BEFORE UPDATE OF application_id, subscription_id, subscriber_id, source_plan_id, source_plan_version,
  target_plan_id, target_plan_version, expected_subscription_version, current_period_start,
  current_period_end, order_id, request_hash, created_at
ON membership_subscription_plan_change_applications
WHEN NEW.application_id IS NOT OLD.application_id
  OR NEW.subscription_id IS NOT OLD.subscription_id
  OR NEW.subscriber_id IS NOT OLD.subscriber_id
  OR NEW.source_plan_id IS NOT OLD.source_plan_id
  OR NEW.source_plan_version IS NOT OLD.source_plan_version
  OR NEW.target_plan_id IS NOT OLD.target_plan_id
  OR NEW.target_plan_version IS NOT OLD.target_plan_version
  OR NEW.expected_subscription_version IS NOT OLD.expected_subscription_version
  OR NEW.current_period_start IS NOT OLD.current_period_start
  OR NEW.current_period_end IS NOT OLD.current_period_end
  OR NEW.order_id IS NOT OLD.order_id
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'paid upgrade application identity is immutable'); END;

CREATE TRIGGER membership_subscription_plan_change_applications_payment_attach_guard
BEFORE UPDATE OF payment_id ON membership_subscription_plan_change_applications
WHEN NOT (
  OLD.status = 'PENDING_PAYMENT'
  AND OLD.payment_id IS NULL
  AND NEW.status = 'READY'
  AND NEW.payment_id IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'a payment may be attached only to a pending paid-upgrade reservation'); END;

CREATE TRIGGER membership_subscription_plan_change_applications_version_guard
BEFORE UPDATE ON membership_subscription_plan_change_applications
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'paid upgrade application requires version CAS and increasing updated_at'); END;

CREATE TRIGGER membership_subscription_plan_change_applications_state_guard
BEFORE UPDATE OF status ON membership_subscription_plan_change_applications
WHEN NOT ((OLD.status = 'PENDING_PAYMENT' AND NEW.status = 'READY' AND OLD.payment_id IS NULL AND NEW.payment_id IS NOT NULL) OR (OLD.status = 'READY' AND NEW.status = 'APPLIED'))
BEGIN SELECT RAISE(ABORT, 'paid upgrade application has an invalid state transition'); END;

CREATE TRIGGER membership_subscription_plan_change_applications_applied_guard
BEFORE UPDATE OF status ON membership_subscription_plan_change_applications
WHEN NEW.status = 'APPLIED' AND NOT EXISTS (
  SELECT 1 FROM membership_subscriptions s
  WHERE s.subscription_id = NEW.subscription_id
    AND s.subscriber_id = NEW.subscriber_id
    AND s.plan_id = NEW.target_plan_id
    AND s.plan_version = NEW.target_plan_version
    AND s.version = NEW.expected_subscription_version + 1
    AND s.current_period_start = NEW.current_period_start
    AND s.current_period_end = NEW.current_period_end
)
BEGIN SELECT RAISE(ABORT, 'paid upgrade application is applied only after the matching subscription plan transition'); END;

-- Preserve the scheduled-at-renewal path from migration 0005 and admit an
-- immediate plan switch only when a READY application created after a verified
-- payment webhook matches the exact subscription CAS and unchanged billing cycle.
DROP TRIGGER membership_subscriptions_plan_change_requires_scheduled_record;
CREATE TRIGGER membership_subscriptions_plan_change_requires_scheduled_record
BEFORE UPDATE OF plan_id, plan_version ON membership_subscriptions
WHEN (NEW.plan_id <> OLD.plan_id OR NEW.plan_version <> OLD.plan_version)
  AND NOT (
    NEW.current_period_start > OLD.current_period_start
    AND EXISTS (
      SELECT 1 FROM membership_subscription_plan_changes pc
      WHERE pc.subscription_id = OLD.subscription_id
        AND pc.subscriber_id = OLD.subscriber_id
        AND pc.source_plan_id = OLD.plan_id
        AND pc.source_plan_version = OLD.plan_version
        AND pc.target_plan_id = NEW.plan_id
        AND pc.target_plan_version = NEW.plan_version
        AND pc.status = 'SCHEDULED'
        AND pc.effective_at <= NEW.current_period_start
    )
  )
  AND NOT (
    NEW.current_period_start = OLD.current_period_start
    AND NEW.current_period_end = OLD.current_period_end
    AND NEW.version = OLD.version + 1
    AND EXISTS (
      SELECT 1 FROM membership_subscription_plan_change_applications a
      WHERE a.subscription_id = OLD.subscription_id
        AND a.subscriber_id = OLD.subscriber_id
        AND a.source_plan_id = OLD.plan_id
        AND a.source_plan_version = OLD.plan_version
        AND a.target_plan_id = NEW.plan_id
        AND a.target_plan_version = NEW.plan_version
        AND a.expected_subscription_version = OLD.version
        AND a.current_period_start = OLD.current_period_start
        AND a.current_period_end = OLD.current_period_end
        AND a.status = 'READY'
    )
  )
BEGIN SELECT RAISE(ABORT, 'subscription plan can only change after a paid scheduled period or verified upgrade application'); END;

CREATE TRIGGER membership_subscription_plan_change_applications_mark_applied
AFTER UPDATE OF plan_id, plan_version ON membership_subscriptions
WHEN NEW.plan_id <> OLD.plan_id OR NEW.plan_version <> OLD.plan_version
BEGIN
  UPDATE membership_subscription_plan_change_applications
  SET status = 'APPLIED', version = version + 1, updated_at = NEW.updated_at
  WHERE subscription_id = NEW.subscription_id
    AND subscriber_id = NEW.subscriber_id
    AND source_plan_id = OLD.plan_id
    AND source_plan_version = OLD.plan_version
    AND target_plan_id = NEW.plan_id
    AND target_plan_version = NEW.plan_version
    AND status = 'READY';
END;

CREATE TRIGGER membership_subscription_plan_change_applications_retained
BEFORE DELETE ON membership_subscription_plan_change_applications
BEGIN SELECT RAISE(ABORT, 'paid upgrade application history is retained'); END;

CREATE TRIGGER membership_subscription_plan_changes_block_when_upgrade_reserved
BEFORE INSERT ON membership_subscription_plan_changes
WHEN EXISTS (
  SELECT 1 FROM membership_subscription_plan_change_applications a
  WHERE a.subscription_id = NEW.subscription_id
    AND a.status IN ('PENDING_PAYMENT','READY')
)
BEGIN SELECT RAISE(ABORT, 'scheduled plan change conflicts with an active paid upgrade checkout'); END;
