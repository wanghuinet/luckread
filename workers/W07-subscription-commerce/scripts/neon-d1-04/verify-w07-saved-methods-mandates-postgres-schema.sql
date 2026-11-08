\set ON_ERROR_STOP on

DO $$
DECLARE
  table_count INTEGER;
  explicit_index_count INTEGER;
  trigger_count INTEGER;
  trigger_function_count INTEGER;
  foreign_key_count INTEGER;
  unexpected_names TEXT[];
  forbidden_columns TEXT[];
BEGIN
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'EXPECTED_POSTGRESQL_18';
  END IF;

  SELECT count(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = current_schema()
    AND table_type = 'BASE TABLE'
    AND table_name = ANY (ARRAY[
      'orders','order_lines','order_create_idempotency',
      'payments','payment_provider_events','payment_provider_event_conflicts',
      'saved_payment_methods','payment_mandates'
    ]);
  IF table_count <> 8 THEN
    RAISE EXCEPTION 'EXPECTED_8_CUMULATIVE_W07_D104_TABLES_GOT_%', table_count;
  END IF;

  SELECT array_agg(table_name) INTO unexpected_names
  FROM information_schema.tables
  WHERE table_schema = current_schema()
    AND table_type = 'BASE TABLE'
    AND table_name = ANY (ARRAY[
      'subscription_renewal_cycles','subscription_renewal_scheduler_state',
      'revenuecat_webhook_events','revenuecat_webhook_event_conflicts',
      'refunds','billing_documents','payment_method_revocation_requests',
      'entitlements','ledger_entries','payment_intents','users','media'
    ]);
  IF unexpected_names IS NOT NULL THEN
    RAISE EXCEPTION 'UNEXPECTED_DEFERRED_OR_CROSS_DOMAIN_TABLES_%', array_to_string(unexpected_names, ',');
  END IF;

  SELECT count(*) INTO explicit_index_count
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = ANY (ARRAY[
      'ix_orders_customer_created_order',
      'ix_orders_status_created_order',
      'ix_order_lines_order_id',
      'ix_order_lines_item_ref_version',
      'ix_order_create_idempotency_customer_created',
      'ix_order_create_idempotency_expiration',
      'ix_payments_customer_created_payment',
      'ix_payments_order_created_payment',
      'ix_payments_status_updated_payment',
      'ux_payments_single_live_or_successful_per_order',
      'ix_payment_provider_events_state_received',
      'ix_payment_provider_events_payment_received',
      'ix_payment_provider_event_conflicts_state_last_seen',
      'ix_payment_provider_event_conflicts_identity',
      'ix_saved_payment_methods_customer_created',
      'ux_payment_mandates_provider_mandate_id',
      'ix_payment_mandates_customer_status_created',
      'ix_payment_mandates_method_status'
    ]);
  IF explicit_index_count <> 18 THEN
    RAISE EXCEPTION 'EXPECTED_18_CUMULATIVE_EXPLICIT_INDEXES_GOT_%', explicit_index_count;
  END IF;

  SELECT count(*) INTO trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname IN (
      'orders','order_lines','order_create_idempotency',
      'payments','payment_provider_events','payment_provider_event_conflicts',
      'saved_payment_methods','payment_mandates'
    )
    AND NOT t.tgisinternal;
  IF trigger_count <> 36 THEN
    RAISE EXCEPTION 'EXPECTED_36_CUMULATIVE_SOURCE_SEMANTIC_TRIGGERS_GOT_%', trigger_count;
  END IF;

  SELECT count(*) INTO trigger_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema()
    AND p.proname IN (
      'w07_d104_order_payment_source_guard',
      'w07_d104_saved_mandate_source_guard'
    );
  IF trigger_function_count <> 2 THEN
    RAISE EXCEPTION 'EXPECTED_2_CUMULATIVE_W07_D104_TRIGGER_FUNCTIONS_GOT_%', trigger_function_count;
  END IF;

  SELECT count(*) INTO foreign_key_count
  FROM information_schema.table_constraints
  WHERE constraint_schema = current_schema()
    AND constraint_type = 'FOREIGN KEY'
    AND table_name IN (
      'orders','order_lines','order_create_idempotency',
      'payments','payment_provider_events','payment_provider_event_conflicts',
      'saved_payment_methods','payment_mandates'
    );
  IF foreign_key_count <> 0 THEN
    RAISE EXCEPTION 'EXPECTED_ZERO_D104_FOREIGN_KEYS_GOT_%', foreign_key_count;
  END IF;

  SELECT array_agg(column_name) INTO forbidden_columns
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name IN ('saved_payment_methods','payment_mandates')
    AND lower(column_name) = ANY (ARRAY[
      'pan','card_number','cvc','cvv','raw_body','client_secret','api_key'
    ]);
  IF forbidden_columns IS NOT NULL THEN
    RAISE EXCEPTION 'SENSITIVE_PAYMENT_DATA_COLUMN_MUST_NOT_EXIST_%', array_to_string(forbidden_columns, ',');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'ux_payment_mandates_provider_mandate_id'
      AND indexdef LIKE '%WHERE (provider_mandate_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'PROVIDER_MANDATE_ID_PARTIAL_UNIQUE_INDEX_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name='payment_mandates'
      AND column_name='created_at' AND data_type='timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name='payment_mandates'
      AND column_name='version' AND data_type='bigint'
  ) THEN
    RAISE EXCEPTION 'W07_D104_MANDATE_POSTGRES_NATIVE_TYPE_MAPPING_MISSING';
  END IF;
END;
$$;

BEGIN;

INSERT INTO order_create_idempotency (
  id, customer_id, operation_key, idempotency_key, request_hash,
  state, response_status, response_json, created_at, expires_at
) VALUES (
  'idem-mandate-fixture-1', 'customer-mandate-1', 'POST /v1/commerce/orders',
  'order-mandate-fixture-1', repeat('a',64), 'COMPLETED', 201,
  '{"orderId":"order-mandate-fixture-1"}', TIMESTAMPTZ '2026-11-01T00:00:00Z',
  TIMESTAMPTZ '2026-11-02T00:00:00Z'
);

INSERT INTO orders (
  order_id, customer_id, status, version, currency,
  subtotal_minor, discount_minor, tax_minor, total_minor,
  created_at, updated_at
) VALUES (
  'order-mandate-fixture-1', 'customer-mandate-1', 'CREATED', 1, 'USD',
  1000, 0, 0, 1000,
  TIMESTAMPTZ '2026-11-01T00:00:00Z',
  TIMESTAMPTZ '2026-11-01T00:00:00Z'
);

INSERT INTO payments (
  payment_id, order_id, customer_id, provider, merchant_id,
  amount_minor, currency, status, version, idempotency_key, request_hash,
  provider_updated_at, failure_code, created_at, updated_at
) VALUES (
  'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'order-mandate-fixture-1', 'customer-mandate-1',
  'hyperswitch', 'merchant-mandate-fixture', 1000, 'USD', 'INITIATING', 1,
  'payment-mandate-fixture-1', repeat('b',64), NULL, NULL,
  TIMESTAMPTZ '2026-11-01T00:00:00Z',
  TIMESTAMPTZ '2026-11-01T00:00:00Z'
);

UPDATE payments
SET status='succeeded', version=2,
    provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z',
    updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z'
WHERE payment_id='pay_aaaaaaaaaaaaaaaaaaaaaaaaaa';

INSERT INTO payment_provider_events (
  event_row_id, provider, merchant_id, event_id, event_type, payment_id,
  payload_sha256, state, received_at, processed_at, outcome_code
) VALUES (
  'event-row-mandate-fixture-1', 'hyperswitch', 'merchant-mandate-fixture',
  'event-mandate-fixture-1', 'payment_succeeded',
  'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa', repeat('c',64), 'RECEIVED',
  TIMESTAMPTZ '2026-11-01T00:00:02Z', NULL, NULL
);

DO $$
BEGIN
  -- A successful payment alone is insufficient without the matching RECEIVED signed-event receipt.
  BEGIN
    INSERT INTO saved_payment_methods (
      saved_payment_method_id, provider, merchant_id, customer_id,
      payment_method_id, source_payment_id, source_event_id, created_at
    ) VALUES (
      'spm_xxxxxxxxxxxxxxxxxxxxxxxxxx', 'hyperswitch', 'merchant-mandate-fixture',
      'customer-mandate-1', 'pm_missing_event',
      'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'event-not-received',
      TIMESTAMPTZ '2026-11-01T00:00:03Z'
    );
    RAISE EXCEPTION 'SAVED_METHOD_VERIFIED_EVENT_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO saved_payment_methods (
  saved_payment_method_id, provider, merchant_id, customer_id,
  payment_method_id, source_payment_id, source_event_id, created_at
) VALUES (
  'spm_ssssssssssssssssssssssssss', 'hyperswitch', 'merchant-mandate-fixture',
  'customer-mandate-1', 'pm_hyperswitch_opaque_token_123',
  'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'event-mandate-fixture-1',
  TIMESTAMPTZ '2026-11-01T00:00:03Z'
);

DO $$
BEGIN
  -- Saved provider token identity is immutable.
  BEGIN
    UPDATE saved_payment_methods
    SET payment_method_id='pm_changed_token'
    WHERE saved_payment_method_id='spm_ssssssssssssssssssssssssss';
    RAISE EXCEPTION 'SAVED_METHOD_IDENTITY_IMMUTABILITY_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A provider method token cannot be rebound to another customer even with a different successful payment.
  BEGIN
    INSERT INTO order_create_idempotency (
      id, customer_id, operation_key, idempotency_key, request_hash,
      state, response_status, response_json, created_at, expires_at
    ) VALUES (
      'idem-mandate-fixture-2', 'customer-mandate-2', 'POST /v1/commerce/orders',
      'order-mandate-fixture-2', repeat('d',64), 'COMPLETED', 201,
      '{"orderId":"order-mandate-fixture-2"}', TIMESTAMPTZ '2026-11-01T00:00:00Z',
      TIMESTAMPTZ '2026-11-02T00:00:00Z'
    );
    INSERT INTO orders (
      order_id, customer_id, status, version, currency,
      subtotal_minor, discount_minor, tax_minor, total_minor, created_at, updated_at
    ) VALUES (
      'order-mandate-fixture-2', 'customer-mandate-2', 'CREATED', 1,
      'USD', 1000, 0, 0, 1000, TIMESTAMPTZ '2026-11-01T00:00:00Z',
      TIMESTAMPTZ '2026-11-01T00:00:00Z'
    );
    INSERT INTO payments (
      payment_id, order_id, customer_id, provider, merchant_id,
      amount_minor, currency, status, version, idempotency_key, request_hash,
      created_at, updated_at
    ) VALUES (
      'pay_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'order-mandate-fixture-2', 'customer-mandate-2',
      'hyperswitch', 'merchant-mandate-fixture', 1000, 'USD', 'INITIATING', 1,
      'payment-mandate-fixture-2', repeat('e',64),
      TIMESTAMPTZ '2026-11-01T00:00:00Z', TIMESTAMPTZ '2026-11-01T00:00:00Z'
    );
    UPDATE payments
    SET status='succeeded', version=2,
        provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z',
        updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z'
    WHERE payment_id='pay_bbbbbbbbbbbbbbbbbbbbbbbbbb';
    INSERT INTO payment_provider_events (
      event_row_id, provider, merchant_id, event_id, event_type, payment_id,
      payload_sha256, state, received_at
    ) VALUES (
      'event-row-mandate-fixture-2', 'hyperswitch', 'merchant-mandate-fixture',
      'event-mandate-fixture-2', 'payment_succeeded',
      'pay_bbbbbbbbbbbbbbbbbbbbbbbbbb', repeat('f',64), 'RECEIVED',
      TIMESTAMPTZ '2026-11-01T00:00:02Z'
    );
    INSERT INTO saved_payment_methods (
      saved_payment_method_id, provider, merchant_id, customer_id,
      payment_method_id, source_payment_id, source_event_id, created_at
    ) VALUES (
      'spm_tttttttttttttttttttttttttt', 'hyperswitch', 'merchant-mandate-fixture',
      'customer-mandate-2', 'pm_hyperswitch_opaque_token_123',
      'pay_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'event-mandate-fixture-2',
      TIMESTAMPTZ '2026-11-01T00:00:03Z'
    );
    RAISE EXCEPTION 'CROSS_CUSTOMER_PROVIDER_TOKEN_BINDING_NOT_BLOCKED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  -- Mandate cannot be created already ACTIVE, even with provider timestamp.
  BEGIN
    INSERT INTO payment_mandates (
      mandate_record_id, provider, merchant_id, customer_id, payment_method_id,
      source_payment_id, source_event_id, consent_accepted_at, consent_acceptance_type,
      consent_scope, consent_terms_version, provider_mandate_id, status, version,
      provider_updated_at, created_at, updated_at
    ) VALUES (
      'mnd_xxxxxxxxxxxxxxxxxxxxxxxxxx', 'hyperswitch', 'merchant-mandate-fixture',
      'customer-mandate-1', 'pm_hyperswitch_opaque_token_123',
      'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'event-mandate-fixture-1',
      TIMESTAMPTZ '2026-11-01T00:00:03Z', 'online', 'OFF_SESSION_RECURRING',
      'luckread-recurring-consent-v1', 'provider-mandate-too-early', 'ACTIVE', 1,
      TIMESTAMPTZ '2026-11-01T00:00:04Z',
      TIMESTAMPTZ '2026-11-01T00:00:03Z', TIMESTAMPTZ '2026-11-01T00:00:04Z'
    );
    RAISE EXCEPTION 'MANDATE_PENDING_INITIAL_STATE_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO payment_mandates (
  mandate_record_id, provider, merchant_id, customer_id, payment_method_id,
  source_payment_id, source_event_id, consent_accepted_at, consent_acceptance_type,
  consent_scope, consent_terms_version, provider_mandate_id, status, version,
  provider_updated_at, created_at, updated_at
) VALUES (
  'mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm', 'hyperswitch', 'merchant-mandate-fixture',
  'customer-mandate-1', 'pm_hyperswitch_opaque_token_123',
  'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'event-mandate-fixture-1',
  TIMESTAMPTZ '2026-11-01T00:00:03Z', 'online', 'OFF_SESSION_RECURRING',
  'luckread-recurring-consent-v1', NULL, 'PENDING_PROVIDER_CONFIRMATION', 1,
  NULL, TIMESTAMPTZ '2026-11-01T00:00:03Z',
  TIMESTAMPTZ '2026-11-01T00:00:03Z'
);

DO $$
BEGIN
  -- Consent evidence is immutable.
  BEGIN
    UPDATE payment_mandates
    SET consent_terms_version='luckread-recurring-consent-v2', version=2,
        updated_at=TIMESTAMPTZ '2026-11-01T00:00:04Z'
    WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';
    RAISE EXCEPTION 'MANDATE_CONSENT_IMMUTABILITY_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- CAS version must advance exactly once.
  BEGIN
    UPDATE payment_mandates
    SET updated_at=TIMESTAMPTZ '2026-11-01T00:00:04Z'
    WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';
    RAISE EXCEPTION 'MANDATE_VERSION_CAS_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

-- First provider mandate ID assignment, then the only valid activation path.
UPDATE payment_mandates
SET provider_mandate_id='provider-mandate-fixture-1',
    version=2, updated_at=TIMESTAMPTZ '2026-11-01T00:00:04Z'
WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';

UPDATE payment_mandates
SET status='ACTIVE', version=3,
    provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z',
    updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z'
WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';

DO $$
BEGIN
  -- Provider mandate ID cannot change after first assignment.
  BEGIN
    UPDATE payment_mandates
    SET provider_mandate_id='provider-mandate-rewritten',
        version=4, updated_at=TIMESTAMPTZ '2026-11-01T00:00:06Z'
    WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';
    RAISE EXCEPTION 'PROVIDER_MANDATE_ID_IMMUTABILITY_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Provider timestamp is the ordering authority and must strictly advance.
  BEGIN
    UPDATE payment_mandates
    SET version=4, provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z',
        updated_at=TIMESTAMPTZ '2026-11-01T00:00:06Z'
    WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';
    RAISE EXCEPTION 'MANDATE_PROVIDER_TIMESTAMP_MONOTONICITY_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

UPDATE payment_mandates
SET status='REVOKED', version=4,
    provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:07Z',
    updated_at=TIMESTAMPTZ '2026-11-01T00:00:07Z'
WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';

DO $$
BEGIN
  -- An out-of-order ACTIVE event cannot reactivate a revoked mandate.
  BEGIN
    UPDATE payment_mandates
    SET status='ACTIVE', version=5,
        provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:08Z',
        updated_at=TIMESTAMPTZ '2026-11-01T00:00:08Z'
    WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';
    RAISE EXCEPTION 'REVOKED_MANDATE_REACTIVATION_NOT_BLOCKED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM payment_mandates
    WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';
    RAISE EXCEPTION 'MANDATE_FINANCIAL_RETENTION_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM saved_payment_methods
    WHERE saved_payment_method_id='spm_ssssssssssssssssssssssssss';
    RAISE EXCEPTION 'SAVED_METHOD_RETENTION_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;

DO $$
DECLARE
  remaining_rows BIGINT;
BEGIN
  SELECT
    (SELECT count(*) FROM orders) +
    (SELECT count(*) FROM order_lines) +
    (SELECT count(*) FROM order_create_idempotency) +
    (SELECT count(*) FROM payments) +
    (SELECT count(*) FROM payment_provider_events) +
    (SELECT count(*) FROM payment_provider_event_conflicts) +
    (SELECT count(*) FROM saved_payment_methods) +
    (SELECT count(*) FROM payment_mandates)
  INTO remaining_rows;
  IF remaining_rows <> 0 THEN
    RAISE EXCEPTION 'W07_D104_SAVED_METHOD_MANDATE_ROLLBACK_LEFT_%_FIXTURE_ROWS', remaining_rows;
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'database', current_database(),
  'postgresMajor', 18,
  'cumulativeTables', 8,
  'cumulativeExplicitIndexes', 18,
  'cumulativeTriggers', 36,
  'cumulativeTriggerFunctions', 2,
  'foreignKeys', 0,
  'newSavedMethodMandateTables', 2,
  'newSavedMethodMandateIndexes', 4,
  'newSavedMethodMandateTriggers', 12,
  'newSavedMethodMandateTriggerFunctions', 1,
  'laterFinanceTablesIncluded', false,
  'sensitiveCardOrSecretColumns', 0,
  'rowsAfterRollback', 0,
  'businessDataImported', false,
  'remoteNeonTouched', false,
  'cloudflareD1Touched', false
) AS d1_04_w07_saved_methods_mandates_postflight;
