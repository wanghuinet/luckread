-- PAY-003 saved-method and mandate persistence candidate for existing D1-04.
-- Source-only until the explicit reviewed D1-04 manual migration gate is run.
-- Never store PAN/CVC, provider API credentials, browser client secrets, or raw webhook bodies.
-- Provider payment success alone never activates a mandate; new mandate rows start pending.

CREATE TABLE saved_payment_methods (
  saved_payment_method_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(saved_payment_method_id) = 30 AND substr(saved_payment_method_id, 1, 4) = 'spm_' AND substr(saved_payment_method_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  payment_method_id TEXT NOT NULL
    CHECK (length(payment_method_id) BETWEEN 1 AND 255 AND payment_method_id NOT GLOB '*[^!-~]*'),
  source_payment_id TEXT NOT NULL
    CHECK (length(source_payment_id) = 30 AND substr(source_payment_id, 1, 4) = 'pay_' AND substr(source_payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  source_event_id TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 255),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  UNIQUE (provider, merchant_id, payment_method_id)
);

CREATE INDEX ix_saved_payment_methods_customer_created
  ON saved_payment_methods(customer_id, created_at, saved_payment_method_id);

CREATE TRIGGER saved_payment_methods_require_succeeded_payment
BEFORE INSERT ON saved_payment_methods
WHEN NOT EXISTS (
  SELECT 1 FROM payments p
  WHERE p.payment_id = NEW.source_payment_id
    AND p.provider = NEW.provider
    AND p.merchant_id = NEW.merchant_id
    AND p.customer_id = NEW.customer_id
    AND p.status = 'succeeded'
)
OR NOT EXISTS (
  SELECT 1 FROM payment_provider_events e
  WHERE e.provider = NEW.provider
    AND e.merchant_id = NEW.merchant_id
    AND e.event_id = NEW.source_event_id
    AND e.payment_id = NEW.source_payment_id
    AND e.event_type = 'payment_succeeded'
    AND e.state = 'RECEIVED'
)
BEGIN SELECT RAISE(ABORT, 'saved payment method requires a succeeded customer-bound payment and verified event'); END;

CREATE TRIGGER saved_payment_methods_customer_binding_guard
BEFORE INSERT ON saved_payment_methods
WHEN EXISTS (
  SELECT 1 FROM saved_payment_methods existing
  WHERE existing.provider = NEW.provider
    AND existing.merchant_id = NEW.merchant_id
    AND existing.payment_method_id = NEW.payment_method_id
    AND existing.customer_id <> NEW.customer_id
)
BEGIN SELECT RAISE(ABORT, 'provider payment method cannot be rebound to another customer'); END;

CREATE TRIGGER saved_payment_methods_identity_immutable
BEFORE UPDATE OF saved_payment_method_id, provider, merchant_id, customer_id, payment_method_id, source_payment_id, source_event_id, created_at
ON saved_payment_methods
WHEN NEW.saved_payment_method_id IS NOT OLD.saved_payment_method_id
  OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id
  OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.payment_method_id IS NOT OLD.payment_method_id
  OR NEW.source_payment_id IS NOT OLD.source_payment_id
  OR NEW.source_event_id IS NOT OLD.source_event_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'saved payment method identity is immutable'); END;

CREATE TRIGGER saved_payment_methods_retained
BEFORE DELETE ON saved_payment_methods
BEGIN SELECT RAISE(ABORT, 'saved payment method audit records are retained'); END;

CREATE TABLE payment_mandates (
  mandate_record_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(mandate_record_id) = 30 AND substr(mandate_record_id, 1, 4) = 'mnd_' AND substr(mandate_record_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  provider TEXT NOT NULL CHECK (provider = 'hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 256),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  payment_method_id TEXT NOT NULL
    CHECK (length(payment_method_id) BETWEEN 1 AND 255 AND payment_method_id NOT GLOB '*[^!-~]*'),
  source_payment_id TEXT NOT NULL
    CHECK (length(source_payment_id) = 30 AND substr(source_payment_id, 1, 4) = 'pay_' AND substr(source_payment_id, 5) NOT GLOB '*[^A-Za-z0-9]*'),
  source_event_id TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 255),
  consent_accepted_at TEXT NOT NULL CHECK (length(consent_accepted_at) BETWEEN 1 AND 64),
  consent_acceptance_type TEXT NOT NULL CHECK (consent_acceptance_type = 'online'),
  consent_scope TEXT NOT NULL CHECK (consent_scope = 'OFF_SESSION_RECURRING'),
  consent_terms_version TEXT NOT NULL CHECK (consent_terms_version = 'luckread-recurring-consent-v1'),
  provider_mandate_id TEXT CHECK (provider_mandate_id IS NULL OR length(provider_mandate_id) BETWEEN 1 AND 255),
  status TEXT NOT NULL CHECK (status IN ('PENDING_PROVIDER_CONFIRMATION','ACTIVE','REVOKED','FAILED','EXPIRED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  provider_updated_at TEXT CHECK (provider_updated_at IS NULL OR length(provider_updated_at) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  UNIQUE (provider, merchant_id, source_payment_id),
  UNIQUE (provider, merchant_id, source_event_id),
  CHECK (
    (status = 'PENDING_PROVIDER_CONFIRMATION' AND provider_updated_at IS NULL)
    OR (status <> 'PENDING_PROVIDER_CONFIRMATION' AND provider_updated_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ux_payment_mandates_provider_mandate_id
  ON payment_mandates(provider, merchant_id, provider_mandate_id)
  WHERE provider_mandate_id IS NOT NULL;
CREATE INDEX ix_payment_mandates_customer_status_created
  ON payment_mandates(customer_id, status, created_at, mandate_record_id);
CREATE INDEX ix_payment_mandates_method_status
  ON payment_mandates(provider, merchant_id, payment_method_id, status, updated_at);

CREATE TRIGGER payment_mandates_require_saved_method
BEFORE INSERT ON payment_mandates
WHEN NOT EXISTS (
  SELECT 1 FROM saved_payment_methods m
  WHERE m.provider = NEW.provider
    AND m.merchant_id = NEW.merchant_id
    AND m.customer_id = NEW.customer_id
    AND m.payment_method_id = NEW.payment_method_id
)
OR NOT EXISTS (
  SELECT 1 FROM payments p
  WHERE p.payment_id = NEW.source_payment_id
    AND p.provider = NEW.provider
    AND p.merchant_id = NEW.merchant_id
    AND p.customer_id = NEW.customer_id
    AND p.status = 'succeeded'
)
OR NOT EXISTS (
  SELECT 1 FROM payment_provider_events e
  WHERE e.provider = NEW.provider
    AND e.merchant_id = NEW.merchant_id
    AND e.event_id = NEW.source_event_id
    AND e.payment_id = NEW.source_payment_id
    AND e.event_type = 'payment_succeeded'
    AND e.state = 'RECEIVED'
)
BEGIN SELECT RAISE(ABORT, 'mandate requires matching saved method, succeeded payment and verified event'); END;

CREATE TRIGGER payment_mandates_start_pending
BEFORE INSERT ON payment_mandates
WHEN NEW.status <> 'PENDING_PROVIDER_CONFIRMATION'
  OR NEW.version <> 1
  OR NEW.provider_updated_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'new mandates must await provider confirmation'); END;

CREATE TRIGGER payment_mandates_identity_immutable
BEFORE UPDATE OF mandate_record_id, provider, merchant_id, customer_id, payment_method_id, source_payment_id, source_event_id,
  consent_accepted_at, consent_acceptance_type, consent_scope, consent_terms_version, created_at
ON payment_mandates
WHEN NEW.mandate_record_id IS NOT OLD.mandate_record_id
  OR NEW.provider IS NOT OLD.provider
  OR NEW.merchant_id IS NOT OLD.merchant_id
  OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.payment_method_id IS NOT OLD.payment_method_id
  OR NEW.source_payment_id IS NOT OLD.source_payment_id
  OR NEW.source_event_id IS NOT OLD.source_event_id
  OR NEW.consent_accepted_at IS NOT OLD.consent_accepted_at
  OR NEW.consent_acceptance_type IS NOT OLD.consent_acceptance_type
  OR NEW.consent_scope IS NOT OLD.consent_scope
  OR NEW.consent_terms_version IS NOT OLD.consent_terms_version
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'mandate consent evidence and identity are immutable'); END;

CREATE TRIGGER payment_mandates_version_guard
BEFORE UPDATE ON payment_mandates
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'mandate update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER payment_mandates_transition_guard
BEFORE UPDATE OF status ON payment_mandates
WHEN NOT (
  (OLD.status = 'PENDING_PROVIDER_CONFIRMATION' AND NEW.status IN ('PENDING_PROVIDER_CONFIRMATION','ACTIVE','REVOKED','FAILED','EXPIRED'))
  OR (OLD.status = 'ACTIVE' AND NEW.status IN ('ACTIVE','REVOKED','EXPIRED'))
  OR (OLD.status IN ('REVOKED','FAILED','EXPIRED') AND NEW.status = OLD.status)
)
BEGIN SELECT RAISE(ABORT, 'forbidden mandate status transition'); END;

CREATE TRIGGER payment_mandates_provider_id_immutable
BEFORE UPDATE OF provider_mandate_id ON payment_mandates
WHEN OLD.provider_mandate_id IS NOT NULL AND NEW.provider_mandate_id IS NOT OLD.provider_mandate_id
BEGIN SELECT RAISE(ABORT, 'provider mandate ID cannot change after it is recorded'); END;

CREATE TRIGGER payment_mandates_provider_timestamp_monotonic
BEFORE UPDATE OF provider_updated_at ON payment_mandates
WHEN OLD.provider_updated_at IS NOT NULL AND NEW.provider_updated_at IS NOT NULL
  AND NEW.provider_updated_at <= OLD.provider_updated_at
BEGIN SELECT RAISE(ABORT, 'provider mandate timestamp must advance'); END;

CREATE TRIGGER payment_mandates_retained
BEFORE DELETE ON payment_mandates
BEGIN SELECT RAISE(ABORT, 'mandate audit records are retained'); END;
