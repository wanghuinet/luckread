-- NEON_D1_04_W07_REFUNDS_BILLING_DOCUMENTS_SCHEMA_V1
-- Target: luckread_finance (D1-04), PostgreSQL 18; owner W07 / PAY-006.
-- Additive dependency: PAY-005 RevenueCat inbox plus order/payment predecessors 0001-0004.
-- Translates only migrations-d1-04/0006_refunds_billing_documents.sql.
-- Refunds are HyperSwitch-only; billing snapshots remain immutable W07 finance facts.
-- No foreign keys; relationships are enforced by source-semantic triggers.
-- No PAN/CVC, API credentials, raw webhook body, entitlement, ledger, user or media columns.
-- W07_REFUNDS_BILLING_SOURCE_SHA256={{W07_REFUNDS_BILLING_SOURCE_SHA256}}
-- PREVIOUS_ORDER_PAYMENT_SCHEMA_SHA256={{PREVIOUS_ORDER_PAYMENT_SCHEMA_SHA256}}
-- PREVIOUS_SAVED_METHODS_MANDATES_SCHEMA_SHA256={{PREVIOUS_SAVED_METHODS_MANDATES_SCHEMA_SHA256}}
-- PREVIOUS_RENEWAL_CYCLES_SCHEMA_SHA256={{PREVIOUS_RENEWAL_CYCLES_SCHEMA_SHA256}}
-- PREVIOUS_REVENUECAT_WEBHOOK_SCHEMA_SHA256={{PREVIOUS_REVENUECAT_WEBHOOK_SCHEMA_SHA256}}
-- REFUNDS_BILLING_SCHEMA_CONTRACT_SEMANTIC_SHA256={{REFUNDS_BILLING_SCHEMA_CONTRACT_SEMANTIC_SHA256}}
-- BASE_D1_04_CUMULATIVE_CONTRACT_SEMANTIC_SHA256={{BASE_D1_04_CUMULATIVE_CONTRACT_SEMANTIC_SHA256}}
-- D1_04_OWNER_LEDGER_CONTRACT_SHA256={{D1_04_OWNER_LEDGER_CONTRACT_SHA256}}
-- D1_04_OWNER_BOUNDARY_CONTRACT_SHA256={{D1_04_OWNER_BOUNDARY_CONTRACT_SHA256}}

CREATE TABLE refunds (
  refund_id TEXT PRIMARY KEY NOT NULL CHECK (char_length(refund_id)=30 AND refund_id ~ '^ref_[A-Za-z0-9]{26}$'),
  provider TEXT NOT NULL CHECK (provider='hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (char_length(merchant_id) BETWEEN 1 AND 256),
  customer_id TEXT NOT NULL CHECK (char_length(customer_id) BETWEEN 1 AND 256),
  order_id TEXT NOT NULL CHECK (char_length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT NOT NULL CHECK (char_length(payment_id)=30 AND payment_id ~ '^pay_[A-Za-z0-9]{26}$'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  captured_amount_minor BIGINT NOT NULL CHECK (captured_amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','REVIEW','RECONCILIATION_REQUIRED')),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 255),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  provider_updated_at TIMESTAMPTZ,
  outcome_code TEXT CHECK (outcome_code IS NULL OR char_length(outcome_code) BETWEEN 1 AND 128),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at>=created_at),
  CONSTRAINT uq_refunds_provider_merchant_refund UNIQUE (provider,merchant_id,refund_id),
  CONSTRAINT uq_refunds_customer_idempotency UNIQUE (customer_id,idempotency_key)
);

CREATE INDEX ix_refunds_customer_created ON refunds(customer_id,created_at,refund_id);
CREATE INDEX ix_refunds_payment_created ON refunds(payment_id,created_at,refund_id);
CREATE INDEX ix_refunds_status_updated ON refunds(status,updated_at,refund_id);

CREATE TABLE billing_documents (
  document_id TEXT PRIMARY KEY NOT NULL CHECK (char_length(document_id) BETWEEN 1 AND 128),
  document_type TEXT NOT NULL CHECK (document_type IN ('INVOICE','RECEIPT')),
  document_number TEXT NOT NULL CHECK (char_length(document_number) BETWEEN 1 AND 128),
  customer_id TEXT NOT NULL CHECK (char_length(customer_id) BETWEEN 1 AND 256),
  order_id TEXT NOT NULL CHECK (char_length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT CHECK (payment_id IS NULL OR (char_length(payment_id)=30 AND payment_id ~ '^pay_[A-Za-z0-9]{26}$')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  snapshot_json TEXT NOT NULL CHECK (char_length(snapshot_json)<=65536 AND snapshot_json::jsonb IS NOT NULL),
  issued_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_billing_documents_type_order UNIQUE (document_type,order_id),
  CONSTRAINT uq_billing_documents_number UNIQUE (document_number),
  CHECK ((document_type='INVOICE' AND payment_id IS NULL) OR (document_type='RECEIPT' AND payment_id IS NOT NULL))
);

CREATE INDEX ix_billing_documents_customer_issued
  ON billing_documents(customer_id,issued_at,document_id);

CREATE FUNCTION w07_d104_refunds_billing_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE
  payment_amount_minor BIGINT;
  previously_refunded_minor BIGINT;
BEGIN
  CASE TG_ARGV[0]
    WHEN 'refunds_require_captured_payment' THEN
      -- Serialize refund reservations for one payment before calculating its
      -- remaining refundable amount. Provider calls remain outside this txn.
      SELECT p.amount_minor INTO payment_amount_minor
      FROM public.payments p
      WHERE p.payment_id=NEW.payment_id
        AND p.order_id=NEW.order_id
        AND p.customer_id=NEW.customer_id
        AND p.merchant_id=NEW.merchant_id
        AND p.provider=NEW.provider
        AND p.currency=NEW.currency
        AND p.status IN ('succeeded','partially_captured')
      FOR UPDATE;
      IF NOT FOUND
        OR NEW.captured_amount_minor>payment_amount_minor
        OR NEW.amount_minor>NEW.captured_amount_minor THEN
        RAISE EXCEPTION 'refund requires a matching captured payment and bounded captured amount'
          USING ERRCODE='23514';
      END IF;
      SELECT COALESCE(SUM(r.amount_minor),0) INTO previously_refunded_minor
      FROM public.refunds r
      WHERE r.payment_id=NEW.payment_id AND r.status<>'FAILED';
      IF NEW.amount_minor>NEW.captured_amount_minor-previously_refunded_minor THEN
        RAISE EXCEPTION 'refund exceeds remaining refundable captured amount'
          USING ERRCODE='23514';
      END IF;
    WHEN 'refunds_identity_immutable' THEN
      IF NEW.refund_id IS DISTINCT FROM OLD.refund_id
        OR NEW.provider IS DISTINCT FROM OLD.provider
        OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
        OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
        OR NEW.order_id IS DISTINCT FROM OLD.order_id
        OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
        OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
        OR NEW.captured_amount_minor IS DISTINCT FROM OLD.captured_amount_minor
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'refund commercial identity is immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'refunds_version_guard' THEN
      IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'refund update requires version CAS and increasing updated_at' USING ERRCODE='23514';
      END IF;
    WHEN 'refunds_state_transition_guard' THEN
      IF NEW.status<>OLD.status AND NOT (
        (OLD.status='REQUESTED' AND NEW.status IN ('PENDING','SUCCEEDED','FAILED','REVIEW','RECONCILIATION_REQUIRED'))
        OR (OLD.status='PENDING' AND NEW.status IN ('SUCCEEDED','FAILED','REVIEW','RECONCILIATION_REQUIRED'))
        OR (OLD.status='REVIEW' AND NEW.status IN ('SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'))
        OR (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status IN ('PENDING','SUCCEEDED','FAILED','REVIEW'))
      ) THEN
        RAISE EXCEPTION 'refund state transition is not allowed' USING ERRCODE='23514';
      END IF;
    WHEN 'refunds_provider_timestamp_monotonic' THEN
      IF OLD.provider_updated_at IS NOT NULL AND NEW.provider_updated_at IS NOT NULL
        AND NEW.provider_updated_at<=OLD.provider_updated_at THEN
        RAISE EXCEPTION 'provider refund update timestamp must advance' USING ERRCODE='23514';
      END IF;
    WHEN 'refunds_retained' THEN
      RAISE EXCEPTION 'refund financial facts are retained' USING ERRCODE='23514';
    WHEN 'billing_documents_source_guard' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.order_id=NEW.order_id AND o.customer_id=NEW.customer_id
          AND o.currency=NEW.currency AND o.total_minor=NEW.amount_minor
      ) OR (
        NEW.document_type='RECEIPT' AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.payment_id=NEW.payment_id AND p.order_id=NEW.order_id
            AND p.customer_id=NEW.customer_id AND p.currency=NEW.currency
            AND p.amount_minor=NEW.amount_minor AND p.status='succeeded'
        )
      ) THEN
        RAISE EXCEPTION 'billing document requires a matching authoritative order/payment'
          USING ERRCODE='23514';
      END IF;
    WHEN 'billing_documents_identity_immutable' THEN
      RAISE EXCEPTION 'issued billing documents are immutable' USING ERRCODE='23514';
    WHEN 'billing_documents_retained' THEN
      RAISE EXCEPTION 'issued billing documents are retained' USING ERRCODE='23514';
    ELSE
      RAISE EXCEPTION 'UNKNOWN_W07_D104_REFUNDS_BILLING_TRIGGER_ACTION_%',TG_ARGV[0]
        USING ERRCODE='55000';
  END CASE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_require_captured_payment
BEFORE INSERT ON refunds
FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('refunds_require_captured_payment');
CREATE TRIGGER refunds_identity_immutable
BEFORE UPDATE OF refund_id,provider,merchant_id,customer_id,order_id,payment_id,amount_minor,
  captured_amount_minor,currency,reason,idempotency_key,request_hash,created_at
ON refunds FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('refunds_identity_immutable');
CREATE TRIGGER refunds_version_guard
BEFORE UPDATE ON refunds
FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('refunds_version_guard');
CREATE TRIGGER refunds_state_transition_guard
BEFORE UPDATE OF status ON refunds
FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('refunds_state_transition_guard');
CREATE TRIGGER refunds_provider_timestamp_monotonic
BEFORE UPDATE OF provider_updated_at ON refunds
FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('refunds_provider_timestamp_monotonic');
CREATE TRIGGER refunds_retained
BEFORE DELETE ON refunds
FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('refunds_retained');

CREATE TRIGGER billing_documents_source_guard
BEFORE INSERT ON billing_documents
FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('billing_documents_source_guard');
CREATE TRIGGER billing_documents_identity_immutable
BEFORE UPDATE ON billing_documents
FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('billing_documents_identity_immutable');
CREATE TRIGGER billing_documents_retained
BEFORE DELETE ON billing_documents
FOR EACH ROW EXECUTE FUNCTION w07_d104_refunds_billing_source_guard('billing_documents_retained');
