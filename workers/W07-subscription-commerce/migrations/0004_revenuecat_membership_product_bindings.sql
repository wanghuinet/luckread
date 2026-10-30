-- Immutable RevenueCat store-product mapping for existing D1-01 MembershipPlan versions.
-- Source candidate only: apply through the controlled D1-01 migration gate after
-- the exact target, prior migration history and postflight schema are verified.
CREATE TABLE IF NOT EXISTS membership_revenuecat_product_bindings (
  revenuecat_app_id TEXT NOT NULL
    CHECK (length(revenuecat_app_id) BETWEEN 1 AND 128),
  store TEXT NOT NULL
    CHECK (store IN ('APP_STORE', 'PLAY_STORE')),
  product_id TEXT NOT NULL
    CHECK (length(product_id) BETWEEN 1 AND 255),
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL
    CHECK (typeof(plan_version) = 'integer' AND plan_version > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at TEXT NOT NULL,
  retired_at TEXT,
  PRIMARY KEY (revenuecat_app_id, store, product_id),
  FOREIGN KEY (plan_id, plan_version)
    REFERENCES membership_plan_versions (plan_id, plan_version) ON DELETE RESTRICT,
  CHECK (
    (status = 'ACTIVE' AND retired_at IS NULL) OR
    (status = 'RETIRED' AND retired_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_membership_revenuecat_bindings_plan_version
  ON membership_revenuecat_product_bindings (plan_id, plan_version, status);

-- A RevenueCat product identifier is bound to one immutable plan version.
-- Retirement is the only permitted update; the row remains available to
-- reconcile renewals/refunds for purchases made against an older plan version.
CREATE TRIGGER IF NOT EXISTS membership_revenuecat_bindings_immutable_update
BEFORE UPDATE ON membership_revenuecat_product_bindings
WHEN
  NEW.revenuecat_app_id IS NOT OLD.revenuecat_app_id OR
  NEW.store IS NOT OLD.store OR
  NEW.product_id IS NOT OLD.product_id OR
  NEW.plan_id IS NOT OLD.plan_id OR
  NEW.plan_version IS NOT OLD.plan_version OR
  NEW.created_at IS NOT OLD.created_at OR
  NOT (
    OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED' AND
    OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'RevenueCat product bindings are immutable except retirement');
END;

CREATE TRIGGER IF NOT EXISTS membership_revenuecat_bindings_immutable_delete
BEFORE DELETE ON membership_revenuecat_product_bindings
BEGIN
  SELECT RAISE(ABORT, 'RevenueCat product bindings are retained for reconciliation');
END;
