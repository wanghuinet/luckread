-- PAY-001 provider payment fact + verified webhook inbox candidate for D1-04.
-- This migration is source-only until the dedicated manual migration gate is reviewed and explicitly run.
-- Raw webhook bodies, API keys, client secrets, card data and entitlement facts are deliberately excluded.

CREATE TABLE payments (
  payment_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(payment_id) = 30 AND substr(payment_id, 1, 4) = 'pay_' AND substr(payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  order_id TEXT NOT NULL CHECK (length(order_id) BETWEEN 1 AND 255),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  amount_minor INTEGER NOT NULL
    CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  status TEXT NOT NULL CHECK (status IN (
    'INITIATING',
    'requires_payment_method',
    'requires_confirmation',
    'requires_customer_action',
    'requires_merchant_action',
    'requires_capture',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
    'cancelled_post_capture',
    'partially_captured',
    'partially_captured_and_capturable',
    'expired'
  )),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  provider_updated_at TEXT CHECK (provider_updated_at IS NULL OR length(provider_updated_at) BETWEEN 1 AND 64),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  UNIQUE (customer_id, idempotency_key)
);
CREATE TRIGGER payments_require_payable_order
BEFORE INSERT ON payments
WHEN NOT EXISTS (
  SELECT 1 FROM orders
  WHERE order_id = NEW.order_id
    AND customer_id = NEW.customer_id
    AND currency = NEW.currency
    AND total_minor = NEW.amount_minor
    AND total_minor > 0
    AND status IN ('CREATED','PENDING_PAYMENT')
)
BEGIN SELECT RAISE(ABORT, 'payment requires a matching positive payable order'); END;

CREATE INDEX ix_payments_customer_created_payment ON payments(customer_id, created_at, payment_id);
CREATE INDEX ix_payments_order_created_payment ON payments(order_id, created_at, payment_id);
CREATE INDEX ix_payments_status_updated_payment ON payments(status, updated_at, payment_id);
CREATE UNIQUE INDEX ux_payments_single_live_or_successful_per_order ON payments(order_id)
WHERE status NOT IN ('failed','cancelled','cancelled_post_capture','expired');

CREATE TRIGGER payments_snapshot_immutable
BEFORE UPDATE OF payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, idempotency_key, request_hash, created_at ON payments
WHEN NEW.payment_id IS NOT OLD.payment_id OR NEW.order_id IS NOT OLD.order_id
  OR NEW.customer_id IS NOT OLD.customer_id OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.amount_minor IS NOT OLD.amount_minor
  OR NEW.currency IS NOT OLD.currency OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.request_hash IS NOT OLD.request_hash OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'payment commercial snapshot is immutable'); END;

CREATE TRIGGER payments_version_must_advance
BEFORE UPDATE ON payments
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'payment update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER payments_terminal_status_guard
BEFORE UPDATE OF status ON payments
WHEN OLD.status IN ('succeeded','failed','cancelled','cancelled_post_capture','expired')
  AND NEW.status <> OLD.status
BEGIN SELECT RAISE(ABORT, 'terminal provider payment status cannot be reopened'); END;

CREATE TRIGGER payments_provider_timestamp_monotonic
BEFORE UPDATE OF provider_updated_at ON payments
WHEN OLD.provider_updated_at IS NOT NULL AND NEW.provider_updated_at IS NOT NULL
  AND NEW.provider_updated_at <= OLD.provider_updated_at
BEGIN SELECT RAISE(ABORT, 'provider payment update timestamp must advance'); END;

CREATE TRIGGER payments_retained
BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'payment facts are retained for financial audit'); END;

CREATE TABLE payment_provider_events (
  event_row_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_row_id) BETWEEN 1 AND 255),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 255),
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 96),
  payment_id TEXT CHECK (payment_id IS NULL OR length(payment_id) BETWEEN 1 AND 255),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (state IN ('RECEIVED','APPLIED','RECONCILIATION_REQUIRED','REJECTED')),
  received_at TEXT NOT NULL CHECK (length(received_at) BETWEEN 1 AND 64),
  processed_at TEXT CHECK (processed_at IS NULL OR length(processed_at) BETWEEN 1 AND 64),
  outcome_code TEXT CHECK (outcome_code IS NULL OR length(outcome_code) BETWEEN 1 AND 128),
  UNIQUE (provider, merchant_id, event_id),
  CHECK (
    (state = 'RECEIVED' AND processed_at IS NULL)
    OR (state <> 'RECEIVED' AND processed_at IS NOT NULL)
  )
);
CREATE INDEX ix_payment_provider_events_state_received ON payment_provider_events(state, received_at, event_row_id);
CREATE INDEX ix_payment_provider_events_payment_received ON payment_provider_events(payment_id, received_at, event_row_id);

CREATE TRIGGER payment_provider_events_identity_immutable
BEFORE UPDATE OF event_row_id, provider, merchant_id, event_id, event_type, payment_id, payload_sha256, received_at ON payment_provider_events
WHEN NEW.event_row_id IS NOT OLD.event_row_id OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.event_id IS NOT OLD.event_id
  OR NEW.event_type IS NOT OLD.event_type OR NEW.payment_id IS NOT OLD.payment_id
  OR NEW.payload_sha256 IS NOT OLD.payload_sha256 OR NEW.received_at IS NOT OLD.received_at
BEGIN SELECT RAISE(ABORT, 'provider webhook event identity is immutable'); END;

CREATE TRIGGER payment_provider_events_terminal_immutable
BEFORE UPDATE ON payment_provider_events
WHEN OLD.state <> 'RECEIVED'
BEGIN SELECT RAISE(ABORT, 'processed provider webhook events are immutable'); END;

CREATE TRIGGER payment_provider_events_retained
BEFORE DELETE ON payment_provider_events
BEGIN SELECT RAISE(ABORT, 'provider webhook deduplication evidence is retained'); END;


-- Durable evidence for a cryptographically valid event ID that is replayed with
-- a different payload hash. Keep it separate from the immutable first receipt.
CREATE TABLE payment_provider_event_conflicts (
  conflict_id TEXT PRIMARY KEY NOT NULL CHECK (length(conflict_id) BETWEEN 1 AND 255),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 255),
  existing_payload_sha256 TEXT NOT NULL CHECK (length(existing_payload_sha256) = 64 AND existing_payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  incoming_payload_sha256 TEXT NOT NULL CHECK (length(incoming_payload_sha256) = 64 AND incoming_payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (typeof(occurrence_count) = 'integer' AND occurrence_count >= 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  first_seen_at TEXT NOT NULL CHECK (length(first_seen_at) BETWEEN 1 AND 64),
  last_seen_at TEXT NOT NULL CHECK (length(last_seen_at) BETWEEN 1 AND 64 AND last_seen_at >= first_seen_at),
  resolved_at TEXT CHECK (resolved_at IS NULL OR length(resolved_at) BETWEEN 1 AND 64),
  resolution_code TEXT CHECK (resolution_code IS NULL OR length(resolution_code) BETWEEN 1 AND 128),
  UNIQUE (provider, merchant_id, event_id, incoming_payload_sha256),
  CHECK (existing_payload_sha256 <> incoming_payload_sha256),
  CHECK (
    (state = 'OPEN' AND resolved_at IS NULL AND resolution_code IS NULL)
    OR (state = 'RESOLVED' AND resolved_at IS NOT NULL AND resolution_code IS NOT NULL)
  )
);
CREATE INDEX ix_payment_provider_event_conflicts_state_last_seen ON payment_provider_event_conflicts(state, last_seen_at, conflict_id);
CREATE INDEX ix_payment_provider_event_conflicts_identity ON payment_provider_event_conflicts(provider, merchant_id, event_id);

CREATE TRIGGER payment_provider_event_conflicts_reference_first_receipt
BEFORE INSERT ON payment_provider_event_conflicts
WHEN NOT EXISTS (
  SELECT 1
  FROM payment_provider_events
  WHERE provider = NEW.provider
    AND merchant_id = NEW.merchant_id
    AND event_id = NEW.event_id
    AND payload_sha256 = NEW.existing_payload_sha256
)
BEGIN SELECT RAISE(ABORT, 'provider event conflict must reference the immutable first receipt'); END;

CREATE TRIGGER payment_provider_event_conflicts_identity_immutable
BEFORE UPDATE OF conflict_id, provider, merchant_id, event_id, existing_payload_sha256, incoming_payload_sha256, first_seen_at ON payment_provider_event_conflicts
WHEN NEW.conflict_id IS NOT OLD.conflict_id OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.event_id IS NOT OLD.event_id
  OR NEW.existing_payload_sha256 IS NOT OLD.existing_payload_sha256
  OR NEW.incoming_payload_sha256 IS NOT OLD.incoming_payload_sha256 OR NEW.first_seen_at IS NOT OLD.first_seen_at
BEGIN SELECT RAISE(ABORT, 'provider event conflict identity is immutable'); END;

CREATE TRIGGER payment_provider_event_conflicts_version_guard
BEFORE UPDATE ON payment_provider_event_conflicts
WHEN NEW.version <> OLD.version + 1 OR NEW.last_seen_at < OLD.last_seen_at
  OR NEW.occurrence_count < OLD.occurrence_count OR NEW.occurrence_count > OLD.occurrence_count + 1
BEGIN SELECT RAISE(ABORT, 'provider event conflict update requires version CAS and monotonic observation'); END;

CREATE TRIGGER payment_provider_event_conflicts_resolved_immutable
BEFORE UPDATE ON payment_provider_event_conflicts
WHEN OLD.state = 'RESOLVED'
BEGIN SELECT RAISE(ABORT, 'resolved provider event conflicts are immutable'); END;

CREATE TRIGGER payment_provider_event_conflicts_retained
BEFORE DELETE ON payment_provider_event_conflicts
BEGIN SELECT RAISE(ABORT, 'provider event conflict evidence is retained'); END;
