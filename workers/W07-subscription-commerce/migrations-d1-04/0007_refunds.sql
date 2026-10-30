-- PAY-004 durable refund request and provider lifecycle facts in existing D1-04.
-- Record the last authenticated provider-reported captured balance so concurrent
-- partial refund reservations are bounded by amount_captured, not intent amount.
-- 0007 is additive; old payments start at zero and require a live provider
-- retrieve before any refund can be reserved.
ALTER TABLE payments
  ADD COLUMN amount_captured_minor INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(amount_captured_minor) = 'integer'
    AND amount_captured_minor BETWEEN 0 AND 9007199254740991);

CREATE TRIGGER payments_captured_amount_observation_guard
BEFORE UPDATE OF amount_captured_minor ON payments
WHEN NEW.amount_captured_minor < OLD.amount_captured_minor
  OR NEW.amount_captured_minor > NEW.amount_minor
  OR (NEW.amount_captured_minor <> OLD.amount_captured_minor
      AND NEW.status NOT IN ('succeeded','partially_captured','partially_captured_and_capturable'))
BEGIN SELECT RAISE(ABORT, 'captured amount must be a monotonic bounded provider observation'); END;

-- Refunds are separate immutable financial-reversal facts. They never mutate
-- Payment snapshots, write the Wallet/Ledger, or change D1-01 entitlements.
-- This source migration is not applied remotely by this change.

CREATE TABLE refunds (
  refund_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(refund_id) = 30 AND substr(refund_id, 1, 4) = 'ref_' AND substr(refund_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  payment_id TEXT NOT NULL,
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  amount_minor INTEGER NOT NULL
    CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 255),
  status TEXT NOT NULL CHECK (status IN ('INITIATING','pending','succeeded','failed','review')),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key NOT GLOB '*[^A-Za-z0-9_-]*'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  provider_updated_at TEXT CHECK (provider_updated_at IS NULL OR length(provider_updated_at) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  UNIQUE(customer_id, idempotency_key),
  FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
);

CREATE INDEX ix_refunds_customer_created_refund
  ON refunds(customer_id, created_at, refund_id);
CREATE INDEX ix_refunds_payment_created_refund
  ON refunds(payment_id, created_at, refund_id);
CREATE INDEX ix_refunds_status_updated_refund
  ON refunds(status, updated_at, refund_id);

-- A refund may be requested only by the owner of an already captured/succeeded
-- payment. Local reservations include INITIATING, pending, review and succeeded;
-- failed attempts release the amount. Hyperswitch independently validates the
-- connector's actual amount_captured ceiling at execution time.
CREATE TRIGGER refunds_require_captured_payment_and_available_amount
BEFORE INSERT ON refunds
WHEN NOT EXISTS (
  SELECT 1 FROM payments p
  WHERE p.payment_id = NEW.payment_id
    AND p.customer_id = NEW.customer_id
    AND p.provider = NEW.provider
    AND p.merchant_id = NEW.merchant_id
    AND p.currency = NEW.currency
    AND p.status IN ('succeeded','partially_captured','partially_captured_and_capturable')
    AND p.amount_captured_minor > 0
    AND NEW.amount_minor <= p.amount_captured_minor
    AND NEW.amount_minor + COALESCE((
      SELECT SUM(r.amount_minor) FROM refunds r
      WHERE r.payment_id = p.payment_id
        AND r.status IN ('INITIATING','pending','review','succeeded')
    ), 0) <= p.amount_captured_minor
)
BEGIN SELECT RAISE(ABORT, 'refund requires an owned captured payment and available refundable amount'); END;

CREATE TRIGGER refunds_identity_immutable
BEFORE UPDATE OF refund_id, payment_id, customer_id, provider, merchant_id, amount_minor,
  currency, reason, idempotency_key, request_hash, created_at
ON refunds
WHEN NEW.refund_id IS NOT OLD.refund_id
  OR NEW.payment_id IS NOT OLD.payment_id
  OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id
  OR NEW.amount_minor IS NOT OLD.amount_minor
  OR NEW.currency IS NOT OLD.currency
  OR NEW.reason IS NOT OLD.reason
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'refund request identity and amount snapshot are immutable'); END;

CREATE TRIGGER refunds_version_guard
BEFORE UPDATE ON refunds
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'refund update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER refunds_status_transition_guard
BEFORE UPDATE OF status ON refunds
WHEN NOT (
  (OLD.status = 'INITIATING' AND NEW.status IN ('INITIATING','pending','succeeded','failed','review'))
  OR (OLD.status = 'pending' AND NEW.status IN ('pending','succeeded','failed','review'))
  OR (OLD.status = 'review' AND NEW.status IN ('review','succeeded','failed'))
  OR (OLD.status = 'succeeded' AND NEW.status = 'succeeded')
  OR (OLD.status = 'failed' AND NEW.status = 'failed')
)
BEGIN SELECT RAISE(ABORT, 'forbidden refund status transition'); END;

CREATE TRIGGER refunds_provider_timestamp_monotonic
BEFORE UPDATE OF provider_updated_at ON refunds
WHEN OLD.provider_updated_at IS NOT NULL AND NEW.provider_updated_at IS NOT NULL
  AND NEW.provider_updated_at <= OLD.provider_updated_at
BEGIN SELECT RAISE(ABORT, 'refund provider timestamp must advance'); END;

CREATE TRIGGER refunds_retained
BEFORE DELETE ON refunds
BEGIN SELECT RAISE(ABORT, 'refund financial facts are retained'); END;

-- Link refund lifecycle receipts to both the stable refund and its parent payment.
ALTER TABLE payment_provider_events
  ADD COLUMN refund_id TEXT REFERENCES refunds(refund_id);

DROP TRIGGER IF EXISTS payment_provider_events_identity_immutable;
CREATE TRIGGER payment_provider_events_identity_immutable
BEFORE UPDATE OF event_row_id, provider, merchant_id, event_id, event_type, payment_id,
  payload_sha256, received_at, refund_id
ON payment_provider_events
WHEN NEW.event_row_id IS NOT OLD.event_row_id OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.event_id IS NOT OLD.event_id
  OR NEW.event_type IS NOT OLD.event_type OR NEW.payment_id IS NOT OLD.payment_id
  OR NEW.payload_sha256 IS NOT OLD.payload_sha256 OR NEW.received_at IS NOT OLD.received_at
  OR NEW.refund_id IS NOT OLD.refund_id
BEGIN SELECT RAISE(ABORT, 'provider webhook event identity is immutable'); END;

CREATE TRIGGER payment_provider_events_refund_binding_guard
BEFORE INSERT ON payment_provider_events
WHEN NEW.refund_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM refunds r
    WHERE r.refund_id = NEW.refund_id
      AND r.payment_id = NEW.payment_id
      AND r.provider = NEW.provider
      AND r.merchant_id = NEW.merchant_id
  )
BEGIN SELECT RAISE(ABORT, 'refund webhook receipt requires matching local refund and payment'); END;

-- Every refund starts as a local request reservation; provider status must
-- be learned from the Hyperswitch response or a signature-verified webhook.
CREATE TRIGGER refunds_start_initiating
BEFORE INSERT ON refunds
WHEN NEW.status <> 'INITIATING'
BEGIN SELECT RAISE(ABORT, 'refund requests must begin in INITIATING'); END;
