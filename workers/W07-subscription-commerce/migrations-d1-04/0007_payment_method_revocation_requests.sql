-- PAY-003 saved-payment-method revocation coordination in existing D1-04.
-- Permit only byte-identical mandate webhook receipts previously marked
-- RECONCILIATION_REQUIRED to be reopened by W07 for a later source-row replay.
-- APPLIED and REJECTED provider receipts remain permanently immutable.
DROP TRIGGER IF EXISTS payment_provider_events_terminal_immutable;
CREATE TRIGGER payment_provider_events_terminal_immutable
BEFORE UPDATE ON payment_provider_events
WHEN OLD.state IN ('APPLIED','REJECTED')
  OR (
    OLD.state = 'RECONCILIATION_REQUIRED'
    AND NOT (
      OLD.event_type IN ('mandate_active','mandate_revoked')
      AND NEW.state = 'RECEIVED'
      AND NEW.processed_at IS NULL
      AND NEW.outcome_code IS NULL
    )
  )
BEGIN SELECT RAISE(ABORT, 'processed provider webhook events are immutable except exact reconciliation replay'); END;

-- A local request immediately blocks new MIT renewal submissions. It does not
-- rewrite provider mandate truth: only the signed mandate_revoked webhook may
-- finalize payment_mandates.status = REVOKED.
CREATE TABLE payment_method_revocation_requests (
  revocation_request_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(revocation_request_id) = 30 AND substr(revocation_request_id, 1, 4) = 'pmr_' AND substr(revocation_request_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  saved_payment_method_id TEXT NOT NULL
    CHECK (length(saved_payment_method_id) = 30 AND substr(saved_payment_method_id, 1, 4) = 'spm_' AND substr(saved_payment_method_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  payment_method_id TEXT NOT NULL
    CHECK (length(payment_method_id) BETWEEN 1 AND 255 AND payment_method_id NOT GLOB '*[^!-~]*'),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key NOT GLOB '*[^A-Za-z0-9_-]*'),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','PENDING_PROVIDER','RECONCILIATION_REQUIRED','COMPLETED')),
  provider_method_deleted_at TEXT CHECK (provider_method_deleted_at IS NULL OR length(provider_method_deleted_at) BETWEEN 1 AND 64),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  UNIQUE (saved_payment_method_id),
  FOREIGN KEY (saved_payment_method_id) REFERENCES saved_payment_methods(saved_payment_method_id)
);

CREATE INDEX ix_payment_method_revocation_status
  ON payment_method_revocation_requests(provider, merchant_id, customer_id, status, updated_at);

-- An idempotency key is scoped to one customer and one saved-method removal.
-- Reusing it for another saved method is a deterministic conflict.
CREATE UNIQUE INDEX ux_payment_method_revocation_customer_idempotency
  ON payment_method_revocation_requests(customer_id, idempotency_key);

CREATE TRIGGER payment_method_revocation_request_requires_saved_method
BEFORE INSERT ON payment_method_revocation_requests
WHEN NOT EXISTS (
  SELECT 1 FROM saved_payment_methods s
  WHERE s.saved_payment_method_id = NEW.saved_payment_method_id
    AND s.provider = NEW.provider
    AND s.merchant_id = NEW.merchant_id
    AND s.customer_id = NEW.customer_id
    AND s.payment_method_id = NEW.payment_method_id
)
BEGIN SELECT RAISE(ABORT, 'payment-method revocation request requires matching saved method owner'); END;

CREATE TRIGGER payment_method_revocation_request_identity_immutable
BEFORE UPDATE OF revocation_request_id, saved_payment_method_id, payment_method_id, provider, merchant_id, customer_id, idempotency_key, created_at
ON payment_method_revocation_requests
WHEN NEW.revocation_request_id IS NOT OLD.revocation_request_id
  OR NEW.saved_payment_method_id IS NOT OLD.saved_payment_method_id
  OR NEW.payment_method_id IS NOT OLD.payment_method_id
  OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id
  OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'payment-method revocation request identity is immutable'); END;

CREATE TRIGGER payment_method_revocation_request_version_guard
BEFORE UPDATE ON payment_method_revocation_requests
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'payment-method revocation request update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER payment_method_revocation_request_transition_guard
BEFORE UPDATE OF status ON payment_method_revocation_requests
WHEN NOT (
  (OLD.status = 'REQUESTED' AND NEW.status IN ('REQUESTED','PENDING_PROVIDER','RECONCILIATION_REQUIRED','COMPLETED'))
  OR (OLD.status = 'PENDING_PROVIDER' AND NEW.status IN ('PENDING_PROVIDER','RECONCILIATION_REQUIRED','COMPLETED'))
  OR (OLD.status = 'RECONCILIATION_REQUIRED' AND NEW.status IN ('RECONCILIATION_REQUIRED','PENDING_PROVIDER','COMPLETED'))
  OR (OLD.status = 'COMPLETED' AND NEW.status = 'COMPLETED')
)
BEGIN SELECT RAISE(ABORT, 'forbidden payment-method revocation request transition'); END;

CREATE TRIGGER payment_method_revocation_request_provider_deleted_immutable
BEFORE UPDATE OF provider_method_deleted_at ON payment_method_revocation_requests
WHEN OLD.provider_method_deleted_at IS NOT NULL
  AND NEW.provider_method_deleted_at IS NOT OLD.provider_method_deleted_at
BEGIN SELECT RAISE(ABORT, 'provider payment-method deletion timestamp is immutable'); END;

CREATE TRIGGER payment_method_revocation_request_retained
BEFORE DELETE ON payment_method_revocation_requests
BEGIN SELECT RAISE(ABORT, 'payment-method revocation requests are retained'); END;


CREATE TRIGGER payment_method_revocation_request_completion_guard
BEFORE UPDATE OF status ON payment_method_revocation_requests
WHEN NEW.status = 'COMPLETED' AND (
  NEW.provider_method_deleted_at IS NULL
  OR EXISTS (
    SELECT 1
    FROM payment_mandates m
    JOIN saved_payment_methods s
      ON s.provider = m.provider
     AND s.merchant_id = m.merchant_id
     AND s.customer_id = m.customer_id
     AND s.payment_method_id = m.payment_method_id
    WHERE s.saved_payment_method_id = NEW.saved_payment_method_id
      AND m.status NOT IN ('REVOKED', 'FAILED', 'EXPIRED')
  )
)
BEGIN SELECT RAISE(ABORT, 'payment-method removal requires provider deletion and terminal mandates'); END;
