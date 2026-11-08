-- GENERATED FILE. Do not hand-edit.
-- Regenerate with scripts/neon/generate-d1-01-membership-postgres-migration.mjs.
-- See scripts/neon/templates/d1-01-membership-postgres.sql for the checked schema template.
-- Source of truth remains migrations/0001..0008 and the W07 Subscription contracts.
-- This file is schema-only; runtime remains on Cloudflare D1 pending a separate cutover gate.

-- GENERATED POSTGRESQL 18 SCHEMA TEMPLATE
-- Source migrations: workers/W07-subscription-commerce/migrations/0001..0008
-- Authority: W07 / D1-01 (subscription plans, subscription lifecycle and entitlement references).
-- D1-04 orders, payments, refunds, mandates and financial facts are deliberately excluded.
-- D1-01 identity/creator identifiers remain opaque references; no cross-domain foreign keys.
-- SQLite ISO-8601 TEXT timestamps are represented as PostgreSQL TIMESTAMPTZ.
-- benefits_json remains TEXT; JSONB validates only that the value is a JSON array.
-- No users, subscriptions, plans, purchases or other business rows are seeded.
-- No speculative active-subscription uniqueness constraint is introduced.
-- Runtime stays on Cloudflare D1; this schema is for disposable PostgreSQL CI only.

BEGIN;

CREATE TABLE membership_subscriptions (
  subscription_id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  creator_id TEXT,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at TIMESTAMPTZ,
  entitlement_snapshot_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  trial_converted_at TIMESTAMPTZ
);

CREATE TABLE membership_plans (
  plan_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(plan_id) BETWEEN 1 AND 256),
  owner_type TEXT NOT NULL
    CHECK (owner_type IN ('CREATOR', 'COMMUNITY', 'PLATFORM')),
  owner_id TEXT NOT NULL
    CHECK (length(owner_id) BETWEEN 1 AND 256),
  current_version INTEGER NOT NULL
    CHECK (current_version > 0),
  status TEXT NOT NULL
    CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED')),
  visibility TEXT NOT NULL
    CHECK (visibility IN ('PRIVATE', 'PUBLIC')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE membership_plan_versions (
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL
    CHECK (plan_version > 0),
  name TEXT NOT NULL
    CHECK (length(name) BETWEEN 1 AND 120),
  tier TEXT NOT NULL
    CHECK (length(tier) BETWEEN 1 AND 64 AND tier ~ '^[a-z][a-z0-9_-]{0,63}$'),
  billing_interval TEXT NOT NULL
    CHECK (billing_interval IN ('MONTHLY', 'YEARLY')),
  price_minor INTEGER NOT NULL
    CHECK (price_minor BETWEEN 0 AND 2147483647),
  currency TEXT NOT NULL
    CHECK (currency ~ '^[A-Z]{3}$'),
  benefits_json TEXT NOT NULL DEFAULT '[]'
    CHECK (length(benefits_json) <= 8192 AND jsonb_typeof(benefits_json::jsonb) = 'array'),
  created_at TIMESTAMPTZ NOT NULL,
  trial_period_days INTEGER NOT NULL DEFAULT 0
    CHECK (trial_period_days BETWEEN 0 AND 30),
  PRIMARY KEY (plan_id, plan_version),
  CONSTRAINT membership_plan_versions_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES membership_plans(plan_id) ON DELETE RESTRICT
);

CREATE TABLE membership_revenuecat_product_bindings (
  revenuecat_app_id TEXT NOT NULL
    CHECK (length(revenuecat_app_id) BETWEEN 1 AND 128),
  store TEXT NOT NULL
    CHECK (store IN ('APP_STORE', 'PLAY_STORE')),
  product_id TEXT NOT NULL
    CHECK (length(product_id) BETWEEN 1 AND 255),
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL
    CHECK (plan_version > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ,
  PRIMARY KEY (revenuecat_app_id, store, product_id),
  CONSTRAINT membership_revenuecat_bindings_plan_version_fkey
    FOREIGN KEY (plan_id, plan_version)
    REFERENCES membership_plan_versions(plan_id, plan_version) ON DELETE RESTRICT,
  CONSTRAINT membership_revenuecat_bindings_retirement_check CHECK (
    (status = 'ACTIVE' AND retired_at IS NULL) OR
    (status = 'RETIRED' AND retired_at IS NOT NULL)
  )
);

CREATE TABLE membership_subscription_plan_change_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  expected_subscription_version INTEGER NOT NULL
    CHECK (expected_subscription_version > 0),
  expected_plan_id TEXT NOT NULL,
  expected_plan_version INTEGER NOT NULL
    CHECK (expected_plan_version > 0),
  target_plan_id TEXT NOT NULL,
  target_plan_version INTEGER NOT NULL
    CHECK (target_plan_version > 0),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING_PAYMENT', 'APPLIED', 'EXPIRED', 'RECONCILIATION_REQUIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ,
  applied_subscription_version INTEGER
    CHECK (applied_subscription_version IS NULL OR applied_subscription_version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version > 0),
  CONSTRAINT membership_plan_change_attempts_applied_check CHECK (
    (status = 'APPLIED' AND applied_at IS NOT NULL AND applied_subscription_version IS NOT NULL)
    OR
    (status <> 'APPLIED' AND applied_at IS NULL AND applied_subscription_version IS NULL)
  )
);

CREATE TABLE membership_subscription_scheduled_plan_changes (
  change_id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  expected_subscription_version INTEGER NOT NULL
    CHECK (expected_subscription_version > 0),
  expected_plan_id TEXT NOT NULL,
  expected_plan_version INTEGER NOT NULL
    CHECK (expected_plan_version > 0),
  target_plan_id TEXT NOT NULL,
  target_plan_version INTEGER NOT NULL
    CHECK (target_plan_version > 0),
  effective_at TIMESTAMPTZ NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('SCHEDULED', 'APPLIED', 'CANCELLED', 'RECONCILIATION_REQUIRED')),
  applied_at TIMESTAMPTZ,
  applied_subscription_version INTEGER
    CHECK (applied_subscription_version IS NULL OR applied_subscription_version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version > 0),
  change_type TEXT NOT NULL DEFAULT 'DOWNGRADE'
    CHECK (change_type IN ('DOWNGRADE', 'BILLING_INTERVAL_CHANGE')),
  CONSTRAINT membership_scheduled_plan_changes_applied_check CHECK (
    (status = 'APPLIED' AND applied_at IS NOT NULL AND applied_subscription_version IS NOT NULL)
    OR
    (status <> 'APPLIED' AND applied_at IS NULL AND applied_subscription_version IS NULL)
  )
);

CREATE INDEX ix_membership_subscriptions_subscriber_status_period
  ON membership_subscriptions (subscriber_id, status, current_period_end);
CREATE INDEX ix_membership_subscriptions_plan_version
  ON membership_subscriptions (plan_id, plan_version);
CREATE INDEX ix_membership_subscriptions_creator_status
  ON membership_subscriptions (creator_id, status);
CREATE INDEX ix_membership_subscriptions_updated_at
  ON membership_subscriptions (updated_at);
CREATE UNIQUE INDEX ux_membership_subscriptions_trial_per_subscriber_creator
  ON membership_subscriptions (subscriber_id, creator_id)
  WHERE trial_started_at IS NOT NULL;
CREATE INDEX ix_membership_subscriptions_trial_end
  ON membership_subscriptions (status, trial_ends_at, subscription_id)
  WHERE trial_started_at IS NOT NULL;

CREATE INDEX ix_membership_plans_owner_status_updated
  ON membership_plans (owner_type, owner_id, status, updated_at);
CREATE INDEX ix_membership_plans_status_visibility_updated
  ON membership_plans (status, visibility, updated_at);
CREATE INDEX ix_membership_plan_versions_created
  ON membership_plan_versions (plan_id, created_at);
CREATE INDEX ix_membership_revenuecat_bindings_plan_version
  ON membership_revenuecat_product_bindings (plan_id, plan_version, status);

CREATE UNIQUE INDEX ux_membership_plan_change_attempts_idempotency
  ON membership_subscription_plan_change_attempts (subscriber_id, idempotency_key_hash);
CREATE UNIQUE INDEX ux_membership_plan_change_attempts_pending_subscription
  ON membership_subscription_plan_change_attempts (subscription_id)
  WHERE status = 'PENDING_PAYMENT';
CREATE INDEX ix_membership_plan_change_attempts_order_status
  ON membership_subscription_plan_change_attempts (order_id, status);
CREATE INDEX ix_membership_plan_change_attempts_expiry
  ON membership_subscription_plan_change_attempts (status, expires_at);

CREATE UNIQUE INDEX ux_membership_scheduled_plan_changes_idempotency
  ON membership_subscription_scheduled_plan_changes (subscriber_id, idempotency_key_hash);
CREATE UNIQUE INDEX ux_membership_scheduled_plan_changes_pending_subscription
  ON membership_subscription_scheduled_plan_changes (subscription_id)
  WHERE status = 'SCHEDULED';
CREATE INDEX ix_membership_scheduled_plan_changes_effective
  ON membership_subscription_scheduled_plan_changes (status, effective_at, subscription_id);

CREATE FUNCTION w07_reject_immutable_plan_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'membership plan versions are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER membership_plan_versions_immutable_update
BEFORE UPDATE ON membership_plan_versions
FOR EACH ROW EXECUTE FUNCTION w07_reject_immutable_plan_version_mutation();

CREATE TRIGGER membership_plan_versions_immutable_delete
BEFORE DELETE ON membership_plan_versions
FOR EACH ROW EXECUTE FUNCTION w07_reject_immutable_plan_version_mutation();

CREATE FUNCTION w07_guard_membership_plan_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.owner_type IS DISTINCT FROM OLD.owner_type
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'membership plan owner and identity are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_plans_owner_immutable_update
BEFORE UPDATE OF plan_id, owner_type, owner_id, created_at ON membership_plans
FOR EACH ROW EXECUTE FUNCTION w07_guard_membership_plan_identity();

CREATE FUNCTION w07_guard_membership_plan_current_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_version <= OLD.current_version
     OR NOT EXISTS (
       SELECT 1
       FROM membership_plan_versions
       WHERE plan_id = OLD.plan_id
         AND plan_version = NEW.current_version
     ) THEN
    RAISE EXCEPTION 'membership plan current version must advance to an existing version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_plans_current_version_forward_only
BEFORE UPDATE OF current_version ON membership_plans
FOR EACH ROW EXECUTE FUNCTION w07_guard_membership_plan_current_version();

CREATE FUNCTION w07_guard_revenuecat_binding_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.revenuecat_app_id IS DISTINCT FROM OLD.revenuecat_app_id
     OR NEW.store IS DISTINCT FROM OLD.store
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT (
       OLD.status = 'ACTIVE'
       AND NEW.status = 'RETIRED'
       AND OLD.retired_at IS NULL
       AND NEW.retired_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'RevenueCat product bindings are immutable except retirement'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_revenuecat_bindings_immutable_update
BEFORE UPDATE ON membership_revenuecat_product_bindings
FOR EACH ROW EXECUTE FUNCTION w07_guard_revenuecat_binding_update();

CREATE FUNCTION w07_reject_revenuecat_binding_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'RevenueCat product bindings are retained for reconciliation'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER membership_revenuecat_bindings_immutable_delete
BEFORE DELETE ON membership_revenuecat_product_bindings
FOR EACH ROW EXECUTE FUNCTION w07_reject_revenuecat_binding_delete();

CREATE FUNCTION w07_guard_subscription_trial_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.trial_started_at IS NOT NULL
     AND (
       NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at
       OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     ) THEN
    RAISE EXCEPTION 'subscription trial window is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_subscriptions_trial_window_immutable
BEFORE UPDATE OF trial_started_at, trial_ends_at ON membership_subscriptions
FOR EACH ROW EXECUTE FUNCTION w07_guard_subscription_trial_window();

CREATE FUNCTION w07_guard_subscription_trial_conversion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.trial_converted_at IS NOT NULL
     AND NEW.trial_converted_at IS DISTINCT FROM OLD.trial_converted_at THEN
    RAISE EXCEPTION 'subscription trial conversion timestamp is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_subscriptions_trial_conversion_write_once
BEFORE UPDATE OF trial_converted_at ON membership_subscriptions
FOR EACH ROW EXECUTE FUNCTION w07_guard_subscription_trial_conversion();

COMMIT;
