-- RevenueCat's webhook receipt is a separate provider inbox in existing D1-04.
-- Do not weaken payment_provider_events.provider='hyperswitch'.
-- This migration is source-only until the reviewed D1-04 manual gate is run.

CREATE TABLE revenuecat_webhook_events (
  event_row_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(event_row_id) BETWEEN 1 AND 255),
  app_id TEXT NOT NULL CHECK (length(app_id) BETWEEN 1 AND 255),
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 255),
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
  event_timestamp_ms INTEGER NOT NULL
    CHECK (typeof(event_timestamp_ms) = 'integer' AND event_timestamp_ms BETWEEN 1 AND 9007199254740991),
  api_version TEXT NOT NULL CHECK (length(api_version) BETWEEN 1 AND 32),
  app_user_id TEXT CHECK (app_user_id IS NULL OR length(app_user_id) BETWEEN 1 AND 256),
  product_id TEXT CHECK (product_id IS NULL OR length(product_id) BETWEEN 1 AND 255),
  store TEXT CHECK (store IS NULL OR length(store) BETWEEN 1 AND 64),
  environment TEXT CHECK (environment IS NULL OR environment IN ('PRODUCTION', 'SANDBOX')),
  transaction_id TEXT CHECK (transaction_id IS NULL OR length(transaction_id) BETWEEN 1 AND 255),
  original_transaction_id TEXT CHECK (original_transaction_id IS NULL OR length(original_transaction_id) BETWEEN 1 AND 255),
  event_data_json TEXT NOT NULL
    CHECK (length(event_data_json) BETWEEN 2 AND 16384 AND json_valid(event_data_json) AND json_type(event_data_json) = 'object'),
  payload_sha256 TEXT NOT NULL
    CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (state IN ('RECEIVED', 'APPLIED', 'RECONCILIATION_REQUIRED', 'IGNORED')),
  received_at TEXT NOT NULL CHECK (length(received_at) BETWEEN 1 AND 64),
  processed_at TEXT CHECK (processed_at IS NULL OR length(processed_at) BETWEEN 1 AND 64),
  outcome_code TEXT CHECK (outcome_code IS NULL OR length(outcome_code) BETWEEN 1 AND 128),
  UNIQUE (app_id, event_id),
  CHECK (
    (state = 'RECEIVED' AND processed_at IS NULL) OR
    (state <> 'RECEIVED' AND processed_at IS NOT NULL)
  )
);

CREATE INDEX ix_revenuecat_webhook_events_state_received
  ON revenuecat_webhook_events (state, received_at, event_row_id);
CREATE INDEX ix_revenuecat_webhook_events_user_received
  ON revenuecat_webhook_events (app_user_id, received_at, event_row_id);

CREATE TRIGGER revenuecat_webhook_events_identity_immutable
BEFORE UPDATE OF event_row_id, app_id, event_id, event_type, event_timestamp_ms, api_version,
  app_user_id, product_id, store, environment, transaction_id, original_transaction_id,
  event_data_json, payload_sha256, received_at
ON revenuecat_webhook_events
WHEN NEW.event_row_id IS NOT OLD.event_row_id OR NEW.app_id IS NOT OLD.app_id
  OR NEW.event_id IS NOT OLD.event_id OR NEW.event_type IS NOT OLD.event_type
  OR NEW.event_timestamp_ms IS NOT OLD.event_timestamp_ms OR NEW.api_version IS NOT OLD.api_version
  OR NEW.app_user_id IS NOT OLD.app_user_id OR NEW.product_id IS NOT OLD.product_id
  OR NEW.store IS NOT OLD.store OR NEW.environment IS NOT OLD.environment
  OR NEW.transaction_id IS NOT OLD.transaction_id
  OR NEW.original_transaction_id IS NOT OLD.original_transaction_id
  OR NEW.event_data_json IS NOT OLD.event_data_json OR NEW.payload_sha256 IS NOT OLD.payload_sha256
  OR NEW.received_at IS NOT OLD.received_at
BEGIN
  SELECT RAISE(ABORT, 'RevenueCat webhook event identity and payload are immutable');
END;

CREATE TRIGGER revenuecat_webhook_events_terminal_immutable
BEFORE UPDATE ON revenuecat_webhook_events
WHEN OLD.state <> 'RECEIVED'
BEGIN
  SELECT RAISE(ABORT, 'processed RevenueCat webhook receipts are immutable');
END;

CREATE TRIGGER revenuecat_webhook_events_retained
BEFORE DELETE ON revenuecat_webhook_events
BEGIN
  SELECT RAISE(ABORT, 'RevenueCat webhook receipts are retained for reconciliation');
END;

-- Keep a conflicting payload separate from the immutable first event receipt.
-- No raw webhook bytes or subscriber attributes are stored.
CREATE TABLE revenuecat_webhook_event_conflicts (
  conflict_id TEXT PRIMARY KEY NOT NULL CHECK (length(conflict_id) BETWEEN 1 AND 255),
  app_id TEXT NOT NULL CHECK (length(app_id) BETWEEN 1 AND 255),
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 255),
  existing_payload_sha256 TEXT NOT NULL
    CHECK (length(existing_payload_sha256) = 64 AND existing_payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  incoming_payload_sha256 TEXT NOT NULL
    CHECK (length(incoming_payload_sha256) = 64 AND incoming_payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  occurrence_count INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(occurrence_count) = 'integer' AND occurrence_count >= 1),
  first_seen_at TEXT NOT NULL CHECK (length(first_seen_at) BETWEEN 1 AND 64),
  last_seen_at TEXT NOT NULL CHECK (length(last_seen_at) BETWEEN 1 AND 64 AND last_seen_at >= first_seen_at),
  UNIQUE (app_id, event_id, incoming_payload_sha256),
  CHECK (existing_payload_sha256 <> incoming_payload_sha256)
);

CREATE INDEX ix_revenuecat_webhook_conflicts_event
  ON revenuecat_webhook_event_conflicts (app_id, event_id, last_seen_at);

CREATE TRIGGER revenuecat_webhook_conflicts_reference_first_receipt
BEFORE INSERT ON revenuecat_webhook_event_conflicts
WHEN NOT EXISTS (
  SELECT 1 FROM revenuecat_webhook_events
  WHERE app_id = NEW.app_id AND event_id = NEW.event_id
    AND payload_sha256 = NEW.existing_payload_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'RevenueCat event conflict must reference the immutable first receipt');
END;

CREATE TRIGGER revenuecat_webhook_conflicts_identity_immutable
BEFORE UPDATE OF conflict_id, app_id, event_id, existing_payload_sha256,
  incoming_payload_sha256, first_seen_at
ON revenuecat_webhook_event_conflicts
WHEN NEW.conflict_id IS NOT OLD.conflict_id OR NEW.app_id IS NOT OLD.app_id
  OR NEW.event_id IS NOT OLD.event_id
  OR NEW.existing_payload_sha256 IS NOT OLD.existing_payload_sha256
  OR NEW.incoming_payload_sha256 IS NOT OLD.incoming_payload_sha256
  OR NEW.first_seen_at IS NOT OLD.first_seen_at
BEGIN
  SELECT RAISE(ABORT, 'RevenueCat webhook conflict identity is immutable');
END;

CREATE TRIGGER revenuecat_webhook_conflicts_occurrence_guard
BEFORE UPDATE ON revenuecat_webhook_event_conflicts
WHEN NEW.occurrence_count <> OLD.occurrence_count + 1 OR NEW.last_seen_at < OLD.last_seen_at
BEGIN
  SELECT RAISE(ABORT, 'RevenueCat webhook conflict occurrence must advance');
END;

CREATE TRIGGER revenuecat_webhook_conflicts_retained
BEFORE DELETE ON revenuecat_webhook_event_conflicts
BEGIN
  SELECT RAISE(ABORT, 'RevenueCat webhook conflicts are retained for reconciliation');
END;
