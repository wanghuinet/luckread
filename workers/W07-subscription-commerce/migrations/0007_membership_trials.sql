-- Trial lifecycle remains part of D1-01 Subscription authority.
-- Store trials are reconciled from authenticated RevenueCat customer snapshots;
-- web trials require a persisted Hyperswitch MIT mandate in existing D1-04.

ALTER TABLE membership_plan_versions
  ADD COLUMN trial_days INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(trial_days) = 'integer' AND trial_days BETWEEN 0 AND 90 AND (trial_days = 0 OR price_minor > 0));

CREATE TABLE membership_subscription_trials (
  trial_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(trial_id) = 30 AND substr(trial_id, 1, 4) = 'mtr_' AND substr(trial_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  subscription_id TEXT NOT NULL UNIQUE
    CHECK (length(subscription_id) BETWEEN 1 AND 256),
  subscriber_id TEXT NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 256),
  plan_id TEXT NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 256),
  plan_version INTEGER NOT NULL CHECK (typeof(plan_version) = 'integer' AND plan_version >= 1),
  source TEXT NOT NULL CHECK (source IN ('WEB','APP_STORE','PLAY_STORE')),
  provider_app_id TEXT CHECK (provider_app_id IS NULL OR length(provider_app_id) BETWEEN 1 AND 255),
  product_id TEXT CHECK (product_id IS NULL OR length(product_id) BETWEEN 1 AND 255),
  store_transaction_id TEXT CHECK (store_transaction_id IS NULL OR length(store_transaction_id) BETWEEN 1 AND 255),
  started_at TEXT NOT NULL CHECK (length(started_at) BETWEEN 1 AND 64),
  trial_ends_at TEXT NOT NULL CHECK (length(trial_ends_at) BETWEEN 1 AND 64 AND trial_ends_at > started_at),
  status TEXT NOT NULL CHECK (status IN ('TRIALING','CANCELED','PAYMENT_FAILED','CONVERTED','EXPIRED')),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  CHECK (
    (source = 'WEB' AND provider_app_id IS NULL AND product_id IS NULL AND store_transaction_id IS NULL)
    OR
    (source IN ('APP_STORE','PLAY_STORE') AND provider_app_id IS NOT NULL AND product_id IS NOT NULL AND store_transaction_id IS NOT NULL)
  ),
  FOREIGN KEY (subscription_id) REFERENCES membership_subscriptions(subscription_id) ON DELETE RESTRICT,
  FOREIGN KEY (plan_id, plan_version) REFERENCES membership_plan_versions(plan_id, plan_version) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX ux_membership_subscription_trials_subscriber_plan
  ON membership_subscription_trials(subscriber_id, plan_id);
CREATE UNIQUE INDEX ux_membership_subscription_trials_store_transaction
  ON membership_subscription_trials(source, provider_app_id, store_transaction_id)
  WHERE store_transaction_id IS NOT NULL;
CREATE INDEX ix_membership_subscription_trials_status_end
  ON membership_subscription_trials(status, trial_ends_at, subscription_id);
CREATE INDEX ix_membership_subscription_trials_subscriber_created
  ON membership_subscription_trials(subscriber_id, created_at, trial_id);

CREATE TRIGGER membership_subscription_trials_insert_guard
BEFORE INSERT ON membership_subscription_trials
WHEN NOT EXISTS (
  SELECT 1
  FROM membership_subscriptions s
  INNER JOIN membership_plan_versions v ON v.plan_id = NEW.plan_id AND v.plan_version = NEW.plan_version
  INNER JOIN membership_plans p ON p.plan_id = NEW.plan_id
  WHERE s.subscription_id = NEW.subscription_id
    AND s.subscriber_id = NEW.subscriber_id
    AND s.plan_id = NEW.plan_id
    AND s.plan_version = NEW.plan_version
    AND s.status = 'TRIALING'
    AND s.creator_id = p.owner_id
    AND p.owner_type = 'CREATOR'
    AND s.started_at = NEW.started_at
    AND s.current_period_start = NEW.started_at
    AND s.current_period_end = NEW.trial_ends_at
    AND (
      (NEW.status = 'TRIALING' AND s.cancel_at IS NULL)
      OR
      (NEW.status = 'CANCELED' AND s.cancel_at = NEW.trial_ends_at)
    )
    AND NOT EXISTS (
      SELECT 1 FROM membership_subscriptions other
      WHERE other.subscriber_id = NEW.subscriber_id
        AND other.creator_id = p.owner_id
        AND other.subscription_id <> NEW.subscription_id
        AND other.status IN ('TRIALING','ACTIVE','PAST_DUE')
        AND other.current_period_end > NEW.started_at
        AND (other.cancel_at IS NULL OR other.cancel_at > NEW.started_at)
    )
    AND (
      (NEW.source = 'WEB' AND v.trial_days BETWEEN 1 AND 90 AND v.price_minor > 0)
      OR
      (NEW.source IN ('APP_STORE','PLAY_STORE') AND NEW.provider_app_id IS NOT NULL AND NEW.product_id IS NOT NULL AND NEW.store_transaction_id IS NOT NULL)
    )
)
BEGIN SELECT RAISE(ABORT, 'trial record must match a trialing subscription and immutable plan version'); END;

CREATE TRIGGER membership_subscription_trials_identity_immutable
BEFORE UPDATE OF trial_id, subscription_id, subscriber_id, plan_id, plan_version, source,
  provider_app_id, product_id, store_transaction_id, started_at, trial_ends_at,
  request_hash, created_at
ON membership_subscription_trials
WHEN NEW.trial_id IS NOT OLD.trial_id
  OR NEW.subscription_id IS NOT OLD.subscription_id
  OR NEW.subscriber_id IS NOT OLD.subscriber_id
  OR NEW.plan_id IS NOT OLD.plan_id
  OR NEW.plan_version IS NOT OLD.plan_version
  OR NEW.source IS NOT OLD.source
  OR NEW.provider_app_id IS NOT OLD.provider_app_id
  OR NEW.product_id IS NOT OLD.product_id
  OR NEW.store_transaction_id IS NOT OLD.store_transaction_id
  OR NEW.started_at IS NOT OLD.started_at
  OR NEW.trial_ends_at IS NOT OLD.trial_ends_at
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'membership trial identity is immutable'); END;

CREATE TRIGGER membership_subscription_trials_version_guard
BEFORE UPDATE ON membership_subscription_trials
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'membership trial update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER membership_subscription_trials_state_guard
BEFORE UPDATE OF status ON membership_subscription_trials
WHEN NOT (
  (OLD.status = 'TRIALING' AND NEW.status IN ('CANCELED','PAYMENT_FAILED','CONVERTED','EXPIRED'))
  OR (OLD.status = 'CANCELED' AND NEW.status IN ('CONVERTED','EXPIRED'))
  OR (OLD.status = 'PAYMENT_FAILED' AND NEW.status IN ('CANCELED','CONVERTED','EXPIRED'))
)
BEGIN SELECT RAISE(ABORT, 'membership trial has an invalid state transition'); END;

CREATE TRIGGER membership_subscription_trials_transition_evidence_guard
BEFORE UPDATE OF status ON membership_subscription_trials
WHEN
  (NEW.status = 'CANCELED' AND NOT EXISTS (
    SELECT 1 FROM membership_subscriptions s
    WHERE s.subscription_id = NEW.subscription_id AND s.subscriber_id = NEW.subscriber_id
      AND s.cancel_at = NEW.trial_ends_at
      AND s.status IN ('TRIALING','PAST_DUE')
  ))
  OR
  (NEW.status = 'PAYMENT_FAILED' AND NOT EXISTS (
    SELECT 1 FROM membership_subscriptions s
    WHERE s.subscription_id = NEW.subscription_id AND s.subscriber_id = NEW.subscriber_id
      AND s.status = 'PAST_DUE'
      AND s.current_period_start = NEW.started_at
      AND s.current_period_end = NEW.trial_ends_at
  ))
  OR
  (NEW.status = 'CONVERTED' AND NOT EXISTS (
    SELECT 1 FROM membership_subscriptions s
    WHERE s.subscription_id = NEW.subscription_id AND s.subscriber_id = NEW.subscriber_id
      AND s.status = 'ACTIVE'
      AND s.current_period_start >= NEW.trial_ends_at
      AND s.current_period_end > s.current_period_start
  ))
  OR
  (NEW.status = 'EXPIRED' AND NOT EXISTS (
    SELECT 1 FROM membership_subscriptions s
    WHERE s.subscription_id = NEW.subscription_id AND s.subscriber_id = NEW.subscriber_id
      AND s.status = 'EXPIRED'
  ))
BEGIN SELECT RAISE(ABORT, 'membership trial state change lacks matching subscription evidence'); END;

CREATE TRIGGER membership_subscriptions_trial_failed_sync
AFTER UPDATE OF status ON membership_subscriptions
WHEN OLD.status = 'TRIALING' AND NEW.status = 'PAST_DUE'
BEGIN
  UPDATE membership_subscription_trials
  SET status = 'PAYMENT_FAILED', version = version + 1, updated_at = NEW.updated_at
  WHERE subscription_id = NEW.subscription_id AND subscriber_id = NEW.subscriber_id
    AND status = 'TRIALING';
END;

CREATE TRIGGER membership_subscriptions_trial_converted_sync
AFTER UPDATE OF status, current_period_start ON membership_subscriptions
WHEN OLD.status IN ('TRIALING','PAST_DUE') AND NEW.status = 'ACTIVE'
  AND NEW.current_period_start >= OLD.current_period_end
BEGIN
  UPDATE membership_subscription_trials
  SET status = 'CONVERTED', version = version + 1, updated_at = NEW.updated_at
  WHERE subscription_id = NEW.subscription_id AND subscriber_id = NEW.subscriber_id
    AND status IN ('TRIALING','CANCELED','PAYMENT_FAILED');
END;

CREATE TRIGGER membership_subscriptions_trial_expired_sync
AFTER UPDATE OF status ON membership_subscriptions
WHEN OLD.status IN ('TRIALING','PAST_DUE') AND NEW.status = 'EXPIRED'
BEGIN
  UPDATE membership_subscription_trials
  SET status = 'EXPIRED', version = version + 1, updated_at = NEW.updated_at
  WHERE subscription_id = NEW.subscription_id AND subscriber_id = NEW.subscriber_id
    AND status IN ('TRIALING','CANCELED','PAYMENT_FAILED');
END;

CREATE TRIGGER membership_subscription_trials_retained
BEFORE DELETE ON membership_subscription_trials
BEGIN SELECT RAISE(ABORT, 'membership trial history is retained'); END;
