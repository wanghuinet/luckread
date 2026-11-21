-- PAY-004 refunds + PAY-003 customer billing documents (invoice/receipt).
-- Source-only until the existing protected D1-04 manual migration gate is reviewed and run.
-- Provider calls stay outside D1 transactions. Only signed Hyperswitch events may advance
-- provider refund state. No raw webhook body, card data, provider secret or access snapshot
-- is stored here.

CREATE TABLE refunds (
  refund_id TEXT PRIMARY KEY NOT NULL CHECK (length(refund_id) = 30 AND substr(refund_id, 1, 4) = 'ref_' AND substr(refund_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  order_id TEXT NOT NULL CHECK (length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT NOT NULL CHECK (length(payment_id) = 30 AND substr(payment_id, 1, 4) = 'pay_' AND substr(payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
  captured_amount_minor INTEGER NOT NULL CHECK (typeof(captured_amount_minor) = 'integer' AND captured_amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','REVIEW','RECONCILIATION_REQUIRED')),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 255),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  provider_updated_at TEXT CHECK (provider_updated_at IS NULL OR length(provider_updated_at) BETWEEN 1 AND 64),
  outcome_code TEXT CHECK (outcome_code IS NULL OR length(outcome_code) BETWEEN 1 AND 128),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  UNIQUE (provider, merchant_id, refund_id),
  UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX ix_refunds_customer_created ON refunds(customer_id, created_at, refund_id);
CREATE INDEX ix_refunds_payment_created ON refunds(payment_id, created_at, refund_id);
CREATE INDEX ix_refunds_status_updated ON refunds(status, updated_at, refund_id);

CREATE TRIGGER refunds_require_captured_payment
BEFORE INSERT ON refunds
WHEN NOT EXISTS (
  SELECT 1 FROM payments
  WHERE payment_id = NEW.payment_id
    AND order_id = NEW.order_id
    AND customer_id = NEW.customer_id
    AND merchant_id = NEW.merchant_id
    AND provider = NEW.provider
    AND currency = NEW.currency
    AND status IN ('succeeded','partially_captured')
    AND NEW.captured_amount_minor <= amount_minor
    AND NEW.amount_minor <= NEW.captured_amount_minor
    AND NEW.amount_minor <= NEW.captured_amount_minor - COALESCE((
      SELECT SUM(amount_minor) FROM refunds
      WHERE payment_id = NEW.payment_id AND status <> 'FAILED'
    ), 0)
)
BEGIN SELECT RAISE(ABORT, 'refund requires a matching captured payment and remaining refundable amount'); END;

CREATE TRIGGER refunds_identity_immutable
BEFORE UPDATE OF refund_id, provider, merchant_id, customer_id, order_id, payment_id, amount_minor,
  captured_amount_minor, currency, reason, idempotency_key, request_hash, created_at ON refunds
WHEN NEW.refund_id IS NOT OLD.refund_id OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.order_id IS NOT OLD.order_id OR NEW.payment_id IS NOT OLD.payment_id
  OR NEW.amount_minor IS NOT OLD.amount_minor OR NEW.captured_amount_minor IS NOT OLD.captured_amount_minor
  OR NEW.currency IS NOT OLD.currency OR NEW.reason IS NOT OLD.reason
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'refund commercial identity is immutable'); END;

CREATE TRIGGER refunds_version_guard
BEFORE UPDATE ON refunds
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'refund update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER refunds_state_transition_guard
BEFORE UPDATE OF status ON refunds
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'REQUESTED' AND NEW.status IN ('PENDING','SUCCEEDED','FAILED','REVIEW','RECONCILIATION_REQUIRED')) OR
  (OLD.status = 'PENDING' AND NEW.status IN ('SUCCEEDED','FAILED','REVIEW','RECONCILIATION_REQUIRED')) OR
  (OLD.status = 'REVIEW' AND NEW.status IN ('SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')) OR
  (OLD.status = 'RECONCILIATION_REQUIRED' AND NEW.status IN ('PENDING','SUCCEEDED','FAILED','REVIEW'))
)
BEGIN SELECT RAISE(ABORT, 'refund state transition is not allowed'); END;

CREATE TRIGGER refunds_provider_timestamp_monotonic
BEFORE UPDATE OF provider_updated_at ON refunds
WHEN OLD.provider_updated_at IS NOT NULL AND NEW.provider_updated_at IS NOT NULL
  AND NEW.provider_updated_at <= OLD.provider_updated_at
BEGIN SELECT RAISE(ABORT, 'provider refund update timestamp must advance'); END;

CREATE TRIGGER refunds_retained
BEFORE DELETE ON refunds
BEGIN SELECT RAISE(ABORT, 'refund financial facts are retained'); END;

CREATE TABLE billing_documents (
  document_id TEXT PRIMARY KEY NOT NULL CHECK (length(document_id) BETWEEN 1 AND 128),
  document_type TEXT NOT NULL CHECK (document_type IN ('INVOICE','RECEIPT')),
  document_number TEXT NOT NULL CHECK (length(document_number) BETWEEN 1 AND 128),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  order_id TEXT NOT NULL CHECK (length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT CHECK (payment_id IS NULL OR (length(payment_id) = 30 AND substr(payment_id, 1, 4) = 'pay_' AND substr(payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*')),
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND length(snapshot_json) <= 65536),
  issued_at TEXT NOT NULL CHECK (length(issued_at) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  UNIQUE(document_type, order_id),
  UNIQUE(document_number),
  CHECK ((document_type = 'INVOICE' AND payment_id IS NULL) OR
         (document_type = 'RECEIPT' AND payment_id IS NOT NULL))
);

CREATE INDEX ix_billing_documents_customer_issued ON billing_documents(customer_id, issued_at, document_id);

CREATE TRIGGER billing_documents_source_guard
BEFORE INSERT ON billing_documents
WHEN NOT EXISTS (
  SELECT 1 FROM orders
  WHERE order_id = NEW.order_id AND customer_id = NEW.customer_id
    AND currency = NEW.currency AND total_minor = NEW.amount_minor
) OR (
  NEW.document_type = 'RECEIPT' AND NOT EXISTS (
    SELECT 1 FROM payments
    WHERE payment_id = NEW.payment_id AND order_id = NEW.order_id
      AND customer_id = NEW.customer_id AND currency = NEW.currency
      AND amount_minor = NEW.amount_minor AND status = 'succeeded'
  )
)
BEGIN SELECT RAISE(ABORT, 'billing document requires a matching authoritative order/payment'); END;

CREATE TRIGGER billing_documents_identity_immutable
BEFORE UPDATE ON billing_documents
BEGIN SELECT RAISE(ABORT, 'issued billing documents are immutable'); END;

CREATE TRIGGER billing_documents_retained
BEFORE DELETE ON billing_documents
BEGIN SELECT RAISE(ABORT, 'issued billing documents are retained'); END;
