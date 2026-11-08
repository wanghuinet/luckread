-- NEON_D1_04_W07_REVENUECAT_WEBHOOK_SCHEMA_V1
-- Target: luckread_finance (D1-04), PostgreSQL 18; owner W07 / PAY-005.
-- Additive dependency: 0001 order/payment + 0002 saved methods/mandates + 0003 renewal cycles.
-- Translates only migrations-d1-04/0005_revenuecat_webhook_inbox.sql.
-- RevenueCat is a separate provider inbox; payment_provider_events remains Hyperswitch-only.
-- No raw_body, subscriber_attributes, credentials, entitlement, ledger, user or media columns.
-- No foreign keys; preserve source uniqueness, first-receipt and conflict guards.
-- W07_REVENUECAT_SOURCE_SHA256=0e24fff5e766793311ca4915668a72fc534bb6a932ef1ae9cb1dcc2c67f499b5
-- PREVIOUS_ORDER_PAYMENT_SCHEMA_SHA256=f7851901a0134c307b6cb62709106b09e88df91ed9a26944c343b360f18fa715
-- PREVIOUS_SAVED_METHODS_MANDATES_SCHEMA_SHA256=ac2539e8d299e651880d6f54956f747286407d74749f123c0ee72be1d087b74d
-- PREVIOUS_RENEWAL_CYCLES_SCHEMA_SHA256=c9034361c8ab303f1e03e431122fce09a0ebb5e37a37da692b859ebdcfe4fb10
-- REVENUECAT_SCHEMA_CONTRACT_SEMANTIC_SHA256=850373c262db5ef50fb35cae7b512bfb1bf6c4ecf92701f2b639198e8d25bee8
-- BASE_D1_04_CUMULATIVE_CONTRACT_SEMANTIC_SHA256=8d0b1f26ce1df56af024a3dceee596e37f51e1f0debdc813b61497c571783fa5
-- D1_04_OWNER_LEDGER_CONTRACT_SHA256=2ab4a8d3e919507d5b121d9f1220e4b4f80580b77548c5fb67c8249d5694feb8
-- D1_04_OWNER_BOUNDARY_CONTRACT_SHA256=a6d67b8e7877590d62e8e727cee298725b7cbef616005147b6dca1f3fe619ec1

CREATE TABLE revenuecat_webhook_events (
  event_row_id TEXT PRIMARY KEY NOT NULL CHECK (char_length(event_row_id) BETWEEN 1 AND 255),
  app_id TEXT NOT NULL CHECK (char_length(app_id) BETWEEN 1 AND 255),
  event_id TEXT NOT NULL CHECK (char_length(event_id) BETWEEN 1 AND 255),
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 64),
  event_timestamp_ms BIGINT NOT NULL CHECK (event_timestamp_ms BETWEEN 1 AND 9007199254740991),
  api_version TEXT NOT NULL CHECK (char_length(api_version) BETWEEN 1 AND 32),
  app_user_id TEXT CHECK (app_user_id IS NULL OR char_length(app_user_id) BETWEEN 1 AND 256),
  product_id TEXT CHECK (product_id IS NULL OR char_length(product_id) BETWEEN 1 AND 255),
  store TEXT CHECK (store IS NULL OR char_length(store) BETWEEN 1 AND 64),
  environment TEXT CHECK (environment IS NULL OR environment IN ('PRODUCTION','SANDBOX')),
  transaction_id TEXT CHECK (transaction_id IS NULL OR char_length(transaction_id) BETWEEN 1 AND 255),
  original_transaction_id TEXT CHECK (original_transaction_id IS NULL OR char_length(original_transaction_id) BETWEEN 1 AND 255),
  event_data_json TEXT NOT NULL CHECK (
    char_length(event_data_json) BETWEEN 2 AND 16384
    AND jsonb_typeof(event_data_json::jsonb)='object'
  ),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (state IN ('RECEIVED','APPLIED','RECONCILIATION_REQUIRED','IGNORED')),
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  outcome_code TEXT CHECK (outcome_code IS NULL OR char_length(outcome_code) BETWEEN 1 AND 128),
  CONSTRAINT uq_revenuecat_webhook_events_app_event UNIQUE (app_id,event_id),
  CHECK ((state='RECEIVED' AND processed_at IS NULL) OR (state<>'RECEIVED' AND processed_at IS NOT NULL))
);

CREATE INDEX ix_revenuecat_webhook_events_state_received
  ON revenuecat_webhook_events(state,received_at,event_row_id);
CREATE INDEX ix_revenuecat_webhook_events_user_received
  ON revenuecat_webhook_events(app_user_id,received_at,event_row_id);

CREATE TABLE revenuecat_webhook_event_conflicts (
  conflict_id TEXT PRIMARY KEY NOT NULL CHECK (char_length(conflict_id) BETWEEN 1 AND 255),
  app_id TEXT NOT NULL CHECK (char_length(app_id) BETWEEN 1 AND 255),
  event_id TEXT NOT NULL CHECK (char_length(event_id) BETWEEN 1 AND 255),
  existing_payload_sha256 TEXT NOT NULL CHECK (existing_payload_sha256 ~ '^[0-9a-f]{64}$'),
  incoming_payload_sha256 TEXT NOT NULL CHECK (incoming_payload_sha256 ~ '^[0-9a-f]{64}$'),
  occurrence_count BIGINT NOT NULL DEFAULT 1 CHECK (occurrence_count>=1),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL CHECK (last_seen_at>=first_seen_at),
  CONSTRAINT uq_revenuecat_webhook_event_conflicts_payload UNIQUE (app_id,event_id,incoming_payload_sha256),
  CHECK (existing_payload_sha256<>incoming_payload_sha256)
);

CREATE INDEX ix_revenuecat_webhook_conflicts_event
  ON revenuecat_webhook_event_conflicts(app_id,event_id,last_seen_at);

CREATE FUNCTION w07_d104_revenuecat_inbox_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  CASE TG_ARGV[0]
    WHEN 'revenuecat_webhook_events_identity_immutable' THEN
      IF NEW.event_row_id IS DISTINCT FROM OLD.event_row_id
        OR NEW.app_id IS DISTINCT FROM OLD.app_id
        OR NEW.event_id IS DISTINCT FROM OLD.event_id
        OR NEW.event_type IS DISTINCT FROM OLD.event_type
        OR NEW.event_timestamp_ms IS DISTINCT FROM OLD.event_timestamp_ms
        OR NEW.api_version IS DISTINCT FROM OLD.api_version
        OR NEW.app_user_id IS DISTINCT FROM OLD.app_user_id
        OR NEW.product_id IS DISTINCT FROM OLD.product_id
        OR NEW.store IS DISTINCT FROM OLD.store
        OR NEW.environment IS DISTINCT FROM OLD.environment
        OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
        OR NEW.original_transaction_id IS DISTINCT FROM OLD.original_transaction_id
        OR NEW.event_data_json IS DISTINCT FROM OLD.event_data_json
        OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
        OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
        RAISE EXCEPTION 'RevenueCat webhook event identity and payload are immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'revenuecat_webhook_events_terminal_immutable' THEN
      IF OLD.state <> 'RECEIVED' THEN
        RAISE EXCEPTION 'processed RevenueCat webhook receipts are immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'revenuecat_webhook_events_retained' THEN
      RAISE EXCEPTION 'RevenueCat webhook receipts are retained for reconciliation' USING ERRCODE='23514';
    WHEN 'revenuecat_webhook_conflicts_reference_first_receipt' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.revenuecat_webhook_events e
        WHERE e.app_id=NEW.app_id AND e.event_id=NEW.event_id
          AND e.payload_sha256=NEW.existing_payload_sha256
      ) THEN
        RAISE EXCEPTION 'RevenueCat event conflict must reference the immutable first receipt' USING ERRCODE='23514';
      END IF;
    WHEN 'revenuecat_webhook_conflicts_identity_immutable' THEN
      IF NEW.conflict_id IS DISTINCT FROM OLD.conflict_id
        OR NEW.app_id IS DISTINCT FROM OLD.app_id
        OR NEW.event_id IS DISTINCT FROM OLD.event_id
        OR NEW.existing_payload_sha256 IS DISTINCT FROM OLD.existing_payload_sha256
        OR NEW.incoming_payload_sha256 IS DISTINCT FROM OLD.incoming_payload_sha256
        OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at THEN
        RAISE EXCEPTION 'RevenueCat webhook conflict identity is immutable' USING ERRCODE='23514';
      END IF;
    WHEN 'revenuecat_webhook_conflicts_occurrence_guard' THEN
      IF NEW.occurrence_count <> OLD.occurrence_count + 1 OR NEW.last_seen_at < OLD.last_seen_at THEN
        RAISE EXCEPTION 'RevenueCat webhook conflict occurrence must advance' USING ERRCODE='23514';
      END IF;
    WHEN 'revenuecat_webhook_conflicts_retained' THEN
      RAISE EXCEPTION 'RevenueCat webhook conflicts are retained for reconciliation' USING ERRCODE='23514';
    ELSE
      RAISE EXCEPTION 'UNKNOWN_W07_D104_REVENUECAT_TRIGGER_ACTION_%',TG_ARGV[0] USING ERRCODE='55000';
  END CASE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER revenuecat_webhook_events_identity_immutable
BEFORE UPDATE OF event_row_id,app_id,event_id,event_type,event_timestamp_ms,api_version,app_user_id,product_id,
  store,environment,transaction_id,original_transaction_id,event_data_json,payload_sha256,received_at
ON revenuecat_webhook_events
FOR EACH ROW EXECUTE FUNCTION w07_d104_revenuecat_inbox_source_guard('revenuecat_webhook_events_identity_immutable');
CREATE TRIGGER revenuecat_webhook_events_terminal_immutable
BEFORE UPDATE ON revenuecat_webhook_events
FOR EACH ROW EXECUTE FUNCTION w07_d104_revenuecat_inbox_source_guard('revenuecat_webhook_events_terminal_immutable');
CREATE TRIGGER revenuecat_webhook_events_retained
BEFORE DELETE ON revenuecat_webhook_events
FOR EACH ROW EXECUTE FUNCTION w07_d104_revenuecat_inbox_source_guard('revenuecat_webhook_events_retained');

CREATE TRIGGER revenuecat_webhook_conflicts_reference_first_receipt
BEFORE INSERT ON revenuecat_webhook_event_conflicts
FOR EACH ROW EXECUTE FUNCTION w07_d104_revenuecat_inbox_source_guard('revenuecat_webhook_conflicts_reference_first_receipt');
CREATE TRIGGER revenuecat_webhook_conflicts_identity_immutable
BEFORE UPDATE OF conflict_id,app_id,event_id,existing_payload_sha256,incoming_payload_sha256,first_seen_at
ON revenuecat_webhook_event_conflicts
FOR EACH ROW EXECUTE FUNCTION w07_d104_revenuecat_inbox_source_guard('revenuecat_webhook_conflicts_identity_immutable');
CREATE TRIGGER revenuecat_webhook_conflicts_occurrence_guard
BEFORE UPDATE ON revenuecat_webhook_event_conflicts
FOR EACH ROW EXECUTE FUNCTION w07_d104_revenuecat_inbox_source_guard('revenuecat_webhook_conflicts_occurrence_guard');
CREATE TRIGGER revenuecat_webhook_conflicts_retained
BEFORE DELETE ON revenuecat_webhook_event_conflicts
FOR EACH ROW EXECUTE FUNCTION w07_d104_revenuecat_inbox_source_guard('revenuecat_webhook_conflicts_retained');

COMMENT ON TABLE revenuecat_webhook_events IS
  'W07 D1-04 immutable first-receipt RevenueCat inbox; separate from Hyperswitch payment_provider_events.';
COMMENT ON TABLE revenuecat_webhook_event_conflicts IS
  'W07 D1-04 distinct conflicting RevenueCat payload hashes; references the immutable first receipt.';
COMMENT ON COLUMN revenuecat_webhook_events.event_data_json IS
  'Bounded object-only event data; raw webhook bytes and subscriber_attributes are not stored.';
