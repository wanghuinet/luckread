-- NEON_D1_04_W07_PAYMENT_METHOD_REVOCATION_SCHEMA_V1
-- Target: luckread_finance (D1-04), PostgreSQL 18; owner W07 / PAY-007.
-- Additive dependency: PAY-006 refunds/billing plus source migrations 0001-0006.
-- Translates only migrations-d1-04/0007_payment_method_revocation_requests.sql.
-- The saved-method owner relation is enforced by a trigger; no reference constraint is added.
-- Existing W07 renewal reads continue to exclude any saved method with a non-COMPLETED revocation request.
-- No PAN/CVC, credentials, raw webhook body, entitlement, ledger, user or media columns.
-- W07_PAYMENT_METHOD_REVOCATION_SOURCE_SHA256=f0809cf005667bdc8ec32a3edb7f5e4a6256fac8e676142eb17d9f67097db88e
-- PREVIOUS_ORDER_PAYMENT_SCHEMA_SHA256=26549a4e71010813040f11c7c8169091bc48620774bc5cf4d5f0483651ad7d75
-- PREVIOUS_SAVED_METHODS_MANDATES_SCHEMA_SHA256=71778e8193100670b1d33c733fdf4eac0dae552c2515c54eb3d793860fe10947
-- PREVIOUS_RENEWAL_CYCLES_SCHEMA_SHA256=1e3bbb471e8dfa55fafbd028189a0681fed28e5f6f1276667e4768e8f16653eb
-- PREVIOUS_REVENUECAT_WEBHOOK_SCHEMA_SHA256=ccbdd752754450a1b922b904bc80215d18489fcf41fa32da585a8e6de715d265
-- PREVIOUS_REFUNDS_BILLING_SCHEMA_SHA256=b3958fb50e2a42b74bbb92ec3f88e2366c9be2aa4a3ad1074692c6e3f0d6ea25
-- PAYMENT_METHOD_REVOCATION_SCHEMA_CONTRACT_SEMANTIC_SHA256=c171990e14e29fd523ebcd93bec80e914a5b63a794dc73960b92c742455a31db
-- BASE_D1_04_CUMULATIVE_CONTRACT_SEMANTIC_SHA256=91ea9539ddfea46a98962d45463735064efe4a281f27b497f62d1c371480d73a
-- W07_RENEWAL_RUNTIME_REVOCATION_GUARD_SHA256=ec278cf9e908d9747cb2c820e0b2a36203cdf3d45b404478d7f49029ce40ad69
-- D1_04_OWNER_LEDGER_CONTRACT_SHA256=cb867e81ea395b0a652173b672ed40a3217ba42f875bf5a1302d484f574f7da5
-- D1_04_OWNER_BOUNDARY_CONTRACT_SHA256=48cda5d56a467c26cb2b3a2d018f01ab2ddd52aaaa4f13dfa9d1adf2e26e1bb9

CREATE TABLE payment_method_revocation_requests (
  revocation_request_id TEXT PRIMARY KEY NOT NULL
    CHECK (char_length(revocation_request_id)=30 AND revocation_request_id ~ '^pmr_[A-Za-z0-9]{26}$'),
  saved_payment_method_id TEXT NOT NULL
    CHECK (char_length(saved_payment_method_id)=30 AND saved_payment_method_id ~ '^spm_[A-Za-z0-9]{26}$'),
  payment_method_id TEXT NOT NULL
    CHECK (char_length(payment_method_id) BETWEEN 1 AND 255 AND payment_method_id ~ '^[!-~]+$'),
  provider TEXT NOT NULL CHECK (provider='hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (char_length(merchant_id) BETWEEN 1 AND 256),
  customer_id TEXT NOT NULL CHECK (char_length(customer_id) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{1,128}$'),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','PENDING_PROVIDER','RECONCILIATION_REQUIRED','COMPLETED')),
  provider_method_deleted_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at>=created_at),
  CONSTRAINT uq_payment_method_revocation_saved_method UNIQUE (saved_payment_method_id)
);

CREATE INDEX ix_payment_method_revocation_status
  ON payment_method_revocation_requests(provider,merchant_id,customer_id,status,updated_at);
CREATE UNIQUE INDEX ux_payment_method_revocation_customer_idempotency
  ON payment_method_revocation_requests(customer_id,idempotency_key);

CREATE FUNCTION w07_d104_payment_method_revocation_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  CASE TG_ARGV[0]
    WHEN 'payment_provider_events_terminal_immutable' THEN
      -- A replay must retain the original event identity and payload SHA-256.
      -- The existing identity trigger remains active while this trigger is replaced.
      IF OLD.state IN ('APPLIED','REJECTED')
        OR (
          OLD.state='RECONCILIATION_REQUIRED'
          AND NOT (
            OLD.event_type IN ('mandate_active','mandate_revoked')
            AND NEW.state='RECEIVED'
            AND NEW.processed_at IS NULL
            AND NEW.outcome_code IS NULL
          )
        ) THEN
        RAISE EXCEPTION 'processed provider webhook events are immutable except exact mandate reconciliation replay'
          USING ERRCODE='23514';
      END IF;
    WHEN 'payment_method_revocation_request_requires_saved_method' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.saved_payment_methods s
        WHERE s.saved_payment_method_id=NEW.saved_payment_method_id
          AND s.provider=NEW.provider
          AND s.merchant_id=NEW.merchant_id
          AND s.customer_id=NEW.customer_id
          AND s.payment_method_id=NEW.payment_method_id
      ) THEN
        RAISE EXCEPTION 'payment-method revocation request requires matching saved method owner'
          USING ERRCODE='23514';
      END IF;
    WHEN 'payment_method_revocation_request_identity_immutable' THEN
      IF NEW.revocation_request_id IS DISTINCT FROM OLD.revocation_request_id
        OR NEW.saved_payment_method_id IS DISTINCT FROM OLD.saved_payment_method_id
        OR NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
        OR NEW.provider IS DISTINCT FROM OLD.provider
        OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
        OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'payment-method revocation request identity is immutable'
          USING ERRCODE='23514';
      END IF;
    WHEN 'payment_method_revocation_request_version_guard' THEN
      IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'payment-method revocation request update requires version CAS and increasing updated_at'
          USING ERRCODE='23514';
      END IF;
    WHEN 'payment_method_revocation_request_transition_guard' THEN
      IF NOT (
        (OLD.status='REQUESTED' AND NEW.status IN ('REQUESTED','PENDING_PROVIDER','RECONCILIATION_REQUIRED','COMPLETED'))
        OR (OLD.status='PENDING_PROVIDER' AND NEW.status IN ('PENDING_PROVIDER','RECONCILIATION_REQUIRED','COMPLETED'))
        OR (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status IN ('RECONCILIATION_REQUIRED','PENDING_PROVIDER','COMPLETED'))
        OR (OLD.status='COMPLETED' AND NEW.status='COMPLETED')
      ) THEN
        RAISE EXCEPTION 'forbidden payment-method revocation request transition'
          USING ERRCODE='23514';
      END IF;
    WHEN 'payment_method_revocation_request_provider_deleted_immutable' THEN
      IF OLD.provider_method_deleted_at IS NOT NULL
        AND NEW.provider_method_deleted_at IS DISTINCT FROM OLD.provider_method_deleted_at THEN
        RAISE EXCEPTION 'provider payment-method deletion timestamp is immutable'
          USING ERRCODE='23514';
      END IF;
    WHEN 'payment_method_revocation_request_retained' THEN
      RAISE EXCEPTION 'payment-method revocation requests are retained'
        USING ERRCODE='23514';
    WHEN 'payment_method_revocation_request_completion_guard' THEN
      IF NEW.status='COMPLETED' AND (
        NEW.provider_method_deleted_at IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.payment_mandates m
          JOIN public.saved_payment_methods s
            ON s.provider=m.provider
           AND s.merchant_id=m.merchant_id
           AND s.customer_id=m.customer_id
           AND s.payment_method_id=m.payment_method_id
          WHERE s.saved_payment_method_id=NEW.saved_payment_method_id
            AND m.status NOT IN ('REVOKED','FAILED','EXPIRED')
        )
      ) THEN
        RAISE EXCEPTION 'payment-method removal requires provider deletion and terminal mandates'
          USING ERRCODE='23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'UNKNOWN_W07_D104_PAYMENT_METHOD_REVOCATION_ACTION_%',TG_ARGV[0]
        USING ERRCODE='55000';
  END CASE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Replace only the terminal-event policy branch. Event identity/payload guards,
-- provider inbox uniqueness and retention remain the already-admitted PAY-001 contract.
DROP TRIGGER IF EXISTS payment_provider_events_terminal_immutable ON payment_provider_events;
CREATE TRIGGER payment_provider_events_terminal_immutable
BEFORE UPDATE ON payment_provider_events
FOR EACH ROW EXECUTE FUNCTION w07_d104_payment_method_revocation_source_guard('payment_provider_events_terminal_immutable');

CREATE TRIGGER payment_method_revocation_request_requires_saved_method
BEFORE INSERT ON payment_method_revocation_requests
FOR EACH ROW EXECUTE FUNCTION w07_d104_payment_method_revocation_source_guard('payment_method_revocation_request_requires_saved_method');
CREATE TRIGGER payment_method_revocation_request_identity_immutable
BEFORE UPDATE OF revocation_request_id,saved_payment_method_id,payment_method_id,provider,merchant_id,customer_id,idempotency_key,created_at
ON payment_method_revocation_requests
FOR EACH ROW EXECUTE FUNCTION w07_d104_payment_method_revocation_source_guard('payment_method_revocation_request_identity_immutable');
CREATE TRIGGER payment_method_revocation_request_version_guard
BEFORE UPDATE ON payment_method_revocation_requests
FOR EACH ROW EXECUTE FUNCTION w07_d104_payment_method_revocation_source_guard('payment_method_revocation_request_version_guard');
CREATE TRIGGER payment_method_revocation_request_transition_guard
BEFORE UPDATE OF status ON payment_method_revocation_requests
FOR EACH ROW EXECUTE FUNCTION w07_d104_payment_method_revocation_source_guard('payment_method_revocation_request_transition_guard');
CREATE TRIGGER payment_method_revocation_request_provider_deleted_immutable
BEFORE UPDATE OF provider_method_deleted_at ON payment_method_revocation_requests
FOR EACH ROW EXECUTE FUNCTION w07_d104_payment_method_revocation_source_guard('payment_method_revocation_request_provider_deleted_immutable');
CREATE TRIGGER payment_method_revocation_request_retained
BEFORE DELETE ON payment_method_revocation_requests
FOR EACH ROW EXECUTE FUNCTION w07_d104_payment_method_revocation_source_guard('payment_method_revocation_request_retained');
CREATE TRIGGER payment_method_revocation_request_completion_guard
BEFORE UPDATE OF status ON payment_method_revocation_requests
FOR EACH ROW EXECUTE FUNCTION w07_d104_payment_method_revocation_source_guard('payment_method_revocation_request_completion_guard');

COMMENT ON TABLE payment_method_revocation_requests IS 'W07 D1-04 durable one-way request to stop MIT and remove an opaque provider reference; signed mandate webhooks remain provider mandate truth.';
