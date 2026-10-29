-- PAY-004 recurring membership cycle ledger for existing D1-04 commerce authority.
-- Candidate only; not remotely applied. No new Worker, database, queue or binding.
-- Only an explicit, provider-verified active mandate can enter the payable/submitting states.
-- This migration records billing/charge references and never grants subscription entitlement.

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
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  offer_snapshot_json TEXT NOT NULL CHECK (
    length(offer_snapshot_json) BETWEEN 2 AND 65536 AND json_valid(offer_snapshot_json) AND json_type(offer_snapshot_json) = 'object'
  ),
  amount_minor INTEGER CHECK (amount_minor IS NULL OR (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 0 AND 9007199254740991)),
  pricing_snapshot_json TEXT CHECK (
    pricing_snapshot_json IS NULL OR (
      length(pricing_snapshot_json) BETWEEN 2 AND 65536 AND json_valid(pricing_snapshot_json) AND json_type(pricing_snapshot_json) = 'object'
    )
  ),
  payment_method_id TEXT CHECK (payment_method_id IS NULL OR (length(payment_method_id) BETWEEN 1 AND 255 AND payment_method_id NOT GLOB '*[^!-~]*')),
  mandate_record_id TEXT CHECK (mandate_record_id IS NULL OR (
    length(mandate_record_id) = 30 AND substr(mandate_record_id, 1, 4) = 'mnd_' AND substr(mandate_record_id, 5) NOT GLOB '*[^A-Za-z0-9]*'
  )),
  order_id TEXT CHECK (order_id IS NULL OR length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT CHECK (payment_id IS NULL OR (length(payment_id) = 30 AND substr(payment_id, 1, 4) = 'pay_' AND substr(payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*')),
  state TEXT NOT NULL CHECK (state IN (
    'AWAITING_PRICING','AWAITING_MANDATE','PREPARED','PAYMENT_READY','SUBMITTING','SUBMITTED',
    'SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'
  )),
  attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (typeof(attempt_number) = 'integer' AND attempt_number BETWEEN 0 AND 20),
  provider_response_status TEXT CHECK (provider_response_status IS NULL OR provider_response_status IN (
    'requires_payment_method','requires_confirmation','requires_customer_action','requires_merchant_action',
    'requires_capture','processing','succeeded','failed','cancelled','cancelled_post_capture',
    'partially_captured','partially_captured_and_capturable','expired'
  )),
  outcome_code TEXT CHECK (outcome_code IS NULL OR length(outcome_code) BETWEEN 1 AND 128),
  subscription_sync_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (subscription_sync_state IN ('PENDING','APPLIED','RECONCILIATION_REQUIRED')),
  subscription_sync_updated_at TEXT CHECK (subscription_sync_updated_at IS NULL OR length(subscription_sync_updated_at) BETWEEN 1 AND 64),
  subscription_sync_error_code TEXT CHECK (subscription_sync_error_code IS NULL OR length(subscription_sync_error_code) BETWEEN 1 AND 128),
  lease_token TEXT CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 1 AND 128),
  lease_expires_at TEXT CHECK (lease_expires_at IS NULL OR length(lease_expires_at) BETWEEN 1 AND 64),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  CHECK (
    (state = 'AWAITING_PRICING' AND amount_minor IS NULL AND pricing_snapshot_json IS NULL)
    OR (state <> 'AWAITING_PRICING' AND amount_minor IS NOT NULL AND pricing_snapshot_json IS NOT NULL)
  ),
  CHECK (
    (state IN ('PAYMENT_READY','SUBMITTING','SUBMITTED','SUCCEEDED','FAILED') AND
      payment_method_id IS NOT NULL AND mandate_record_id IS NOT NULL AND order_id IS NOT NULL AND payment_id IS NOT NULL)
    OR state NOT IN ('PAYMENT_READY','SUBMITTING','SUBMITTED','SUCCEEDED','FAILED')
  ),
  CHECK (
    (state = 'SUBMITTING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'SUBMITTING' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK ((payment_method_id IS NULL) = (mandate_record_id IS NULL)),
  CHECK (
    (subscription_sync_state = 'PENDING' AND subscription_sync_updated_at IS NULL AND subscription_sync_error_code IS NULL)
    OR (subscription_sync_state = 'APPLIED' AND subscription_sync_updated_at IS NOT NULL AND subscription_sync_error_code IS NULL)
    OR (subscription_sync_state = 'RECONCILIATION_REQUIRED' AND subscription_sync_updated_at IS NOT NULL AND subscription_sync_error_code IS NOT NULL)
  ),
  CHECK (
    (state IN ('SUCCEEDED','FAILED') AND subscription_sync_state IN ('PENDING','APPLIED','RECONCILIATION_REQUIRED'))
    OR (state NOT IN ('SUCCEEDED','FAILED') AND subscription_sync_state = 'PENDING')
  )
);

-- A cycle is created only as a not-yet-priced record. Financial/provider states
-- must be reached through the versioned runtime transitions and verified evidence.
CREATE TRIGGER subscription_renewal_cycles_initial_state_guard
BEFORE INSERT ON subscription_renewal_cycles
WHEN NEW.state <> 'AWAITING_PRICING'
  OR NEW.amount_minor IS NOT NULL
  OR NEW.pricing_snapshot_json IS NOT NULL
  OR NEW.payment_method_id IS NOT NULL
  OR NEW.mandate_record_id IS NOT NULL
  OR NEW.order_id IS NOT NULL
  OR NEW.payment_id IS NOT NULL
  OR NEW.attempt_number <> 0
  OR NEW.provider_response_status IS NOT NULL
  OR NEW.outcome_code IS NOT NULL
  OR NEW.subscription_sync_state <> 'PENDING'
  OR NEW.subscription_sync_updated_at IS NOT NULL
  OR NEW.subscription_sync_error_code IS NOT NULL
  OR NEW.lease_token IS NOT NULL
  OR NEW.lease_expires_at IS NOT NULL
  OR NEW.version <> 1
BEGIN SELECT RAISE(ABORT, 'new renewal cycles must start awaiting authoritative pricing'); END;

CREATE UNIQUE INDEX ux_subscription_renewal_cycles_subscription_cycle
  ON subscription_renewal_cycles(subscription_id, cycle_start);
CREATE UNIQUE INDEX ux_subscription_renewal_cycles_payment
  ON subscription_renewal_cycles(provider, merchant_id, payment_id)
  WHERE payment_id IS NOT NULL;
CREATE INDEX ix_subscription_renewal_cycles_state_updated
  ON subscription_renewal_cycles(state, updated_at, cycle_id);
CREATE INDEX ix_subscription_renewal_cycles_subscriber_cycle
  ON subscription_renewal_cycles(subscriber_id, cycle_start, cycle_end);

CREATE TRIGGER subscription_renewal_cycles_identity_immutable
BEFORE UPDATE OF cycle_id, provider, merchant_id, subscription_id, subscriber_id, plan_id, plan_version,
  cycle_start, cycle_end, billing_interval, currency, offer_snapshot_json, created_at
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
  OR NEW.currency IS NOT OLD.currency
  OR NEW.offer_snapshot_json IS NOT OLD.offer_snapshot_json
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'renewal cycle identity and offer snapshot are immutable'); END;

CREATE TRIGGER subscription_renewal_cycles_resolved_snapshot_immutable
BEFORE UPDATE OF amount_minor, pricing_snapshot_json, payment_method_id, mandate_record_id
ON subscription_renewal_cycles
WHEN (OLD.amount_minor IS NOT NULL AND NEW.amount_minor IS NOT OLD.amount_minor)
  OR (OLD.pricing_snapshot_json IS NOT NULL AND NEW.pricing_snapshot_json IS NOT OLD.pricing_snapshot_json)
  OR (OLD.payment_method_id IS NOT NULL AND NEW.payment_method_id IS NOT OLD.payment_method_id)
  OR (OLD.mandate_record_id IS NOT NULL AND NEW.mandate_record_id IS NOT OLD.mandate_record_id)
BEGIN SELECT RAISE(ABORT, 'resolved renewal amount, price decision and mandate identity are immutable'); END;

CREATE TRIGGER subscription_renewal_cycles_version_guard
BEFORE UPDATE ON subscription_renewal_cycles
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'renewal-cycle update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER subscription_renewal_cycles_state_transition_guard
BEFORE UPDATE OF state ON subscription_renewal_cycles
WHEN NOT (
  (OLD.state = 'AWAITING_PRICING' AND NEW.state IN ('AWAITING_PRICING','AWAITING_MANDATE','PREPARED','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'AWAITING_MANDATE' AND NEW.state IN ('AWAITING_MANDATE','PREPARED','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'PREPARED' AND NEW.state IN ('PREPARED','AWAITING_MANDATE','PAYMENT_READY','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'PAYMENT_READY' AND NEW.state IN ('PAYMENT_READY','SUBMITTING','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'SUBMITTING' AND NEW.state IN ('SUBMITTING','PAYMENT_READY','SUBMITTED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'SUBMITTED' AND NEW.state IN ('SUBMITTED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'))
  OR (OLD.state = 'FAILED' AND NEW.state IN ('FAILED','PREPARED','RECONCILIATION_REQUIRED'))
  OR (OLD.state IN ('SUCCEEDED','RECONCILIATION_REQUIRED') AND NEW.state = OLD.state)
)
BEGIN SELECT RAISE(ABORT, 'forbidden renewal-cycle state transition'); END;

CREATE TRIGGER subscription_renewal_cycles_sync_state_transition_guard
BEFORE UPDATE ON subscription_renewal_cycles
WHEN NOT (
  (
    OLD.subscription_sync_state = NEW.subscription_sync_state
    AND OLD.subscription_sync_updated_at IS NEW.subscription_sync_updated_at
    AND OLD.subscription_sync_error_code IS NEW.subscription_sync_error_code
  )
  OR (
    OLD.subscription_sync_state = 'PENDING'
    AND NEW.subscription_sync_state IN ('APPLIED','RECONCILIATION_REQUIRED')
    AND OLD.state IN ('SUCCEEDED','FAILED')
    AND NEW.state = OLD.state
  )
  OR (
    OLD.subscription_sync_state = 'APPLIED'
    AND NEW.subscription_sync_state = 'PENDING'
    AND OLD.state = 'FAILED'
    AND NEW.state = 'PREPARED'
    AND NEW.subscription_sync_updated_at IS NULL
    AND NEW.subscription_sync_error_code IS NULL
  )
)
BEGIN SELECT RAISE(ABORT, 'renewal outcome sync state is monotonic except an explicit failed-cycle retry reset'); END;

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
BEGIN SELECT RAISE(ABORT, 'renewal cycle Order must match subscription, cycle and commercial snapshot'); END;

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

CREATE TRIGGER subscription_renewal_cycles_requires_active_mandate
BEFORE UPDATE OF state ON subscription_renewal_cycles
WHEN NEW.state IN ('PAYMENT_READY','SUBMITTING') AND NOT EXISTS (
  SELECT 1 FROM payment_mandates m
  JOIN saved_payment_methods s
    ON s.provider = m.provider AND s.merchant_id = m.merchant_id
   AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id
  WHERE m.mandate_record_id = NEW.mandate_record_id
    AND m.provider = NEW.provider AND m.merchant_id = NEW.merchant_id
    AND m.customer_id = NEW.subscriber_id
    AND m.payment_method_id = NEW.payment_method_id AND m.status = 'ACTIVE'
)
BEGIN SELECT RAISE(ABORT, 'recurring charge requires a matching currently-active provider mandate'); END;

CREATE TRIGGER subscription_renewal_cycles_retained
BEFORE DELETE ON subscription_renewal_cycles
BEGIN SELECT RAISE(ABORT, 'renewal cycle audit records are retained'); END;

CREATE TABLE subscription_renewal_scheduler_state (
  state_id TEXT PRIMARY KEY NOT NULL CHECK (state_id = 'subscription-renewals'),
  cursor_period_end TEXT CHECK (cursor_period_end IS NULL OR length(cursor_period_end) BETWEEN 1 AND 64),
  cursor_subscription_id TEXT CHECK (cursor_subscription_id IS NULL OR length(cursor_subscription_id) BETWEEN 1 AND 256),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64),
  CHECK ((cursor_period_end IS NULL) = (cursor_subscription_id IS NULL))
);

INSERT INTO subscription_renewal_scheduler_state(state_id, cursor_period_end, cursor_subscription_id, version, updated_at)
VALUES ('subscription-renewals', NULL, NULL, 1, '1970-01-01T00:00:00.000Z');

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
