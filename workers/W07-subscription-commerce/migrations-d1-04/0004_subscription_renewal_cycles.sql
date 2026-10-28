-- PAY-004 recurring membership renewal-cycle ledger for the existing D1-04 commerce authority.
-- Candidate only. Remote application remains behind the exact-SHA manual migration workflow.
-- The cycle row stores provider/request references only; it never grants entitlement.
-- Reuse the existing orders/payments tables, and never persist card data or provider secrets.

CREATE TABLE subscription_renewal_cycles (
  cycle_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(cycle_id) = 30 AND substr(cycle_id, 1, 4) = 'rcy_' AND substr(cycle_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  subscription_id TEXT NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 256),
  subscriber_id TEXT NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 256),
  plan_id TEXT NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 255),
  plan_version INTEGER NOT NULL CHECK (typeof(plan_version) = 'integer' AND plan_version >= 1),
  cycle_start TEXT NOT NULL CHECK (length(cycle_start) BETWEEN 1 AND 64),
  cycle_end TEXT NOT NULL CHECK (length(cycle_end) BETWEEN 1 AND 64 AND cycle_end > cycle_start),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('MONTHLY','YEARLY')),
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  payment_method_id TEXT NOT NULL CHECK (length(payment_method_id) BETWEEN 1 AND 255 AND payment_method_id NOT GLOB '*[^!-~]*'),
  mandate_record_id TEXT NOT NULL CHECK (length(mandate_record_id) = 30 AND substr(mandate_record_id, 1, 4) = 'mnd_' AND substr(mandate_record_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  order_id TEXT CHECK (order_id IS NULL OR length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT CHECK (payment_id IS NULL OR (length(payment_id) = 30 AND substr(payment_id, 1, 4) = 'pay_' AND substr(payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*')),
  state TEXT NOT NULL CHECK (state IN ('PREPARED','PAYMENT_READY','SUBMITTING','SUBMITTED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
  provider_response_status TEXT CHECK (provider_response_status IS NULL OR provider_response_status IN (
    'requires_payment_method','requires_confirmation','requires_customer_action','requires_merchant_action',
    'requires_capture','processing','succeeded','failed','cancelled','cancelled_post_capture',
    'partially_captured','partially_captured_and_capturable','expired'
  )),
  lease_token TEXT CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 1 AND 128),
  lease_expires_at TEXT CHECK (lease_expires_at IS NULL OR length(lease_expires_at) BETWEEN 1 AND 64),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  CHECK (
    (state = 'SUBMITTING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'SUBMITTING' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    state NOT IN ('PAYMENT_READY','SUBMITTING','SUBMITTED','SUCCEEDED','FAILED')
    OR (order_id IS NOT NULL AND payment_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ux_subscription_renewal_cycles_subscription_cycle
  ON subscription_renewal_cycles(subscription_id, cycle_start, cycle_end);
CREATE UNIQUE INDEX ux_subscription_renewal_cycles_payment
  ON subscription_renewal_cycles(provider, merchant_id, payment_id)
  WHERE payment_id IS NOT NULL;
CREATE INDEX ix_subscription_renewal_cycles_state_updated
  ON subscription_renewal_cycles(state, updated_at, cycle_id);
CREATE INDEX ix_subscription_renewal_cycles_subscriber_cycle
  ON subscription_renewal_cycles(subscriber_id, cycle_start, cycle_end);

CREATE TRIGGER subscription_renewal_cycles_identity_immutable
BEFORE UPDATE OF cycle_id, provider, merchant_id, subscription_id, subscriber_id, plan_id, plan_version,
  cycle_start, cycle_end, billing_interval, amount_minor, currency, payment_method_id, mandate_record_id, created_at
ON subscription_renewal_cycles
WHEN NEW.cycle_id IS NOT OLD.cycle_id
  OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id
  OR NEW.subscription_id IS NOT OLD.subscription_id
  OR NEW.subscriber_id IS NOT OLD.subscriber_id
  OR NEW.plan_id IS NOT OLD.plan_id
  OR NEW.plan_version IS NOT OLD.plan_version
  OR NEW.cycle_start IS NOT OLD.cycle_start
  OR NEW.cycle_end IS NOT OLD.cycle_end
  OR NEW.billing_interval IS NOT OLD.billing_interval
  OR NEW.amount_minor IS NOT OLD.amount_minor
  OR NEW.currency IS NOT OLD.currency
  OR NEW.payment_method_id IS NOT OLD.payment_method_id
  OR NEW.mandate_record_id IS NOT OLD.mandate_record_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'renewal cycle commercial and mandate snapshot is immutable'); END;

CREATE TRIGGER subscription_renewal_cycles_version_guard
BEFORE UPDATE ON subscription_renewal_cycles
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'renewal-cycle update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER subscription_renewal_cycles_state_transition_guard
BEFORE UPDATE OF state ON subscription_renewal_cycles
WHEN NOT (
  (OLD.state = 'PREPARED' AND NEW.state IN ('PREPARED','PAYMENT_READY','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'PAYMENT_READY' AND NEW.state IN ('PAYMENT_READY','SUBMITTING','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'SUBMITTING' AND NEW.state IN ('SUBMITTING','PAYMENT_READY','SUBMITTED','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'SUBMITTED' AND NEW.state IN ('SUBMITTED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'))
  OR (OLD.state IN ('SUCCEEDED','FAILED','RECONCILIATION_REQUIRED') AND NEW.state = OLD.state)
)
BEGIN SELECT RAISE(ABORT, 'forbidden renewal-cycle state transition'); END;

CREATE TRIGGER subscription_renewal_cycles_order_binding_guard
BEFORE UPDATE OF order_id ON subscription_renewal_cycles
WHEN NEW.order_id IS NOT NULL AND (
  NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.order_id = NEW.order_id
      AND o.customer_id = NEW.subscriber_id
      AND o.currency = NEW.currency
      AND o.total_minor = NEW.amount_minor
  )
  OR NOT EXISTS (
    SELECT 1 FROM order_lines l
    WHERE l.order_id = NEW.order_id
      AND l.item_type = 'MEMBERSHIP_PLAN'
      AND l.item_ref = NEW.plan_id
      AND l.item_version = CAST(NEW.plan_version AS TEXT)
      AND json_valid(l.item_snapshot_json)
      AND json_extract(l.item_snapshot_json, '$.subscriptionRenewal.subscriptionId') = NEW.subscription_id
      AND json_extract(l.item_snapshot_json, '$.subscriptionRenewal.cycleStart') = NEW.cycle_start
      AND json_extract(l.item_snapshot_json, '$.subscriptionRenewal.cycleEnd') = NEW.cycle_end
  )
)
BEGIN SELECT RAISE(ABORT, 'renewal cycle Order must match the subscription, cycle and commercial snapshot'); END;

CREATE TRIGGER subscription_renewal_cycles_payment_binding_guard
BEFORE UPDATE OF payment_id ON subscription_renewal_cycles
WHEN NEW.payment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM payments p
  WHERE p.payment_id = NEW.payment_id
    AND p.order_id = NEW.order_id
    AND p.customer_id = NEW.subscriber_id
    AND p.provider = NEW.provider
    AND p.merchant_id = NEW.merchant_id
    AND p.amount_minor = NEW.amount_minor
    AND p.currency = NEW.currency
)
BEGIN SELECT RAISE(ABORT, 'renewal cycle Payment must match its Order and immutable commercial snapshot'); END;

CREATE TRIGGER subscription_renewal_cycles_retained
BEFORE DELETE ON subscription_renewal_cycles
BEGIN SELECT RAISE(ABORT, 'renewal cycle audit records are retained'); END;

CREATE TABLE subscription_renewal_scheduler_state (
  state_id TEXT PRIMARY KEY NOT NULL CHECK (state_id = 'subscription-renewals'),
  cursor_subscription_id TEXT CHECK (cursor_subscription_id IS NULL OR length(cursor_subscription_id) BETWEEN 1 AND 256),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64)
);

INSERT INTO subscription_renewal_scheduler_state(state_id, cursor_subscription_id, version, updated_at)
VALUES ('subscription-renewals', NULL, 1, '1970-01-01T00:00:00.000Z');

CREATE TRIGGER subscription_renewal_scheduler_state_identity_immutable
BEFORE UPDATE OF state_id ON subscription_renewal_scheduler_state
WHEN NEW.state_id IS NOT OLD.state_id
BEGIN SELECT RAISE(ABORT, 'renewal scheduler state identity is immutable'); END;

CREATE TRIGGER subscription_renewal_scheduler_state_version_guard
BEFORE UPDATE ON subscription_renewal_scheduler_state
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'renewal scheduler cursor update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER subscription_renewal_scheduler_state_retained
BEFORE DELETE ON subscription_renewal_scheduler_state
BEGIN SELECT RAISE(ABORT, 'renewal scheduler state is retained'); END;
