\set ON_ERROR_STOP on

DO $$
DECLARE
  table_count INTEGER;
  explicit_index_count INTEGER;
  trigger_count INTEGER;
  trigger_function_count INTEGER;
  foreign_key_count INTEGER;
  unexpected_names TEXT[];
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
      'payments','payment_provider_events','payment_provider_event_conflicts'
    ]);
  IF table_count <> 6 THEN
    RAISE EXCEPTION 'EXPECTED_6_W07_D104_TABLES_GOT_%', table_count;
  END IF;

  SELECT array_agg(table_name) INTO unexpected_names
  FROM information_schema.tables
  WHERE table_schema = current_schema()
    AND table_type = 'BASE TABLE'
    AND table_name = ANY (ARRAY[
      'saved_payment_methods','payment_mandates','subscription_renewal_cycles',
      'subscription_renewal_scheduler_state','revenuecat_webhook_events',
      'revenuecat_webhook_event_conflicts','refunds','billing_documents',
      'payment_method_revocation_requests','entitlements','ledger_entries',
      'payment_intents','users','media'
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
      'ix_payment_provider_event_conflicts_identity'
    ]);
  IF explicit_index_count <> 14 THEN
    RAISE EXCEPTION 'EXPECTED_14_EXPLICIT_INDEXES_GOT_%', explicit_index_count;
  END IF;

  SELECT count(*) INTO trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname IN (
      'orders','order_lines','order_create_idempotency',
      'payments','payment_provider_events','payment_provider_event_conflicts'
    )
    AND NOT t.tgisinternal;
  IF trigger_count <> 24 THEN
    RAISE EXCEPTION 'EXPECTED_24_SOURCE_SEMANTIC_TRIGGERS_GOT_%', trigger_count;
  END IF;

  SELECT count(*) INTO trigger_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema()
    AND p.proname = 'w07_d104_order_payment_source_guard';
  IF trigger_function_count <> 1 THEN
    RAISE EXCEPTION 'EXPECTED_ONE_W07_D104_TRIGGER_FUNCTION_GOT_%', trigger_function_count;
  END IF;

  SELECT count(*) INTO foreign_key_count
  FROM information_schema.table_constraints
  WHERE constraint_schema = current_schema()
    AND constraint_type = 'FOREIGN KEY'
    AND table_name IN (
      'orders','order_lines','order_create_idempotency',
      'payments','payment_provider_events','payment_provider_event_conflicts'
    );
  IF foreign_key_count <> 0 THEN
    RAISE EXCEPTION 'EXPECTED_ZERO_D104_FOREIGN_KEYS_GOT_%', foreign_key_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name='orders'
      AND column_name='created_at' AND data_type='timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name='payments'
      AND column_name='amount_minor' AND data_type='bigint'
  ) THEN
    RAISE EXCEPTION 'W07_D104_POSTGRES_NATIVE_TYPE_MAPPING_MISSING';
  END IF;
END;
$$;

BEGIN;

INSERT INTO order_create_idempotency (
  id, customer_id, operation_key, idempotency_key, request_hash,
  state, response_status, response_json, created_at, expires_at
) VALUES (
  'idem-fixture', 'customer-fixture', 'POST /v1/commerce/orders',
  'order-fixture-key', repeat('a',64), 'COMPLETED', 201,
  '{"orderId":"order-fixture"}', TIMESTAMPTZ '2026-11-01T00:00:00Z',
  TIMESTAMPTZ '2026-11-02T00:00:00Z'
);

INSERT INTO orders (
  order_id, customer_id, status, version, currency,
  subtotal_minor, discount_minor, tax_minor, total_minor,
  created_at, updated_at
) VALUES (
  'order-fixture', 'customer-fixture', 'CREATED', 1, 'USD',
  1000, 100, 50, 950,
  TIMESTAMPTZ '2026-11-01T00:00:00Z',
  TIMESTAMPTZ '2026-11-01T00:00:00Z'
);

INSERT INTO order_lines (
  order_line_id, order_id, item_type, item_ref, item_version,
  quantity, unit_amount_minor, line_subtotal_minor,
  line_discount_minor, line_tax_minor, line_total_minor,
  item_snapshot_json, created_at
) VALUES (
  'order-line-fixture', 'order-fixture', 'CONTENT', 'content-fixture', '1',
  2, 500, 1000, 100, 50, 950,
  '{"contentId":"content-fixture","version":1}',
  TIMESTAMPTZ '2026-11-01T00:00:00Z'
);

INSERT INTO payments (
  payment_id, order_id, customer_id, provider, merchant_id,
  amount_minor, currency, status, version, idempotency_key, request_hash,
  provider_updated_at, failure_code, created_at, updated_at
) VALUES (
  'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'order-fixture', 'customer-fixture',
  'hyperswitch', 'merchant-fixture', 950, 'USD', 'INITIATING', 1,
  'payment-fixture-key', repeat('b',64), NULL, NULL,
  TIMESTAMPTZ '2026-11-01T00:00:00Z',
  TIMESTAMPTZ '2026-11-01T00:00:00Z'
);

INSERT INTO payment_provider_events (
  event_row_id, provider, merchant_id, event_id, event_type, payment_id,
  payload_sha256, state, received_at, processed_at, outcome_code
) VALUES (
  'provider-event-fixture', 'hyperswitch', 'merchant-fixture',
  'event-fixture', 'payment_succeeded',
  'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa', repeat('c',64), 'RECEIVED',
  TIMESTAMPTZ '2026-11-01T00:00:01Z', NULL, NULL
);

INSERT INTO payment_provider_event_conflicts (
  conflict_id, provider, merchant_id, event_id,
  existing_payload_sha256, incoming_payload_sha256, state,
  occurrence_count, version, first_seen_at, last_seen_at, resolved_at, resolution_code
) VALUES (
  'provider-conflict-fixture', 'hyperswitch', 'merchant-fixture', 'event-fixture',
  repeat('c',64), repeat('d',64), 'OPEN', 1, 1,
  TIMESTAMPTZ '2026-11-01T00:00:02Z',
  TIMESTAMPTZ '2026-11-01T00:00:02Z', NULL, NULL
);

DO $$
BEGIN
  -- An Order must point to the exact completed idempotency response.
  BEGIN
    INSERT INTO orders (
      order_id, customer_id, status, version, currency,
      subtotal_minor, discount_minor, tax_minor, total_minor, created_at, updated_at
    ) VALUES (
      'order-without-idempotency', 'customer-fixture', 'CREATED', 1,
      'USD', 100, 0, 0, 100, now(), now()
    );
    RAISE EXCEPTION 'ORDER_IDEMPOTENCY_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Order transition gate rejects skipping payment/confirmation steps.
  BEGIN
    UPDATE orders SET status='COMPLETED', version=2, updated_at=TIMESTAMPTZ '2026-11-01T00:00:03Z'
    WHERE order_id='order-fixture';
    RAISE EXCEPTION 'ORDER_TRANSITION_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Money snapshot is immutable.
  BEGIN
    UPDATE orders SET total_minor=949, version=2, updated_at=TIMESTAMPTZ '2026-11-01T00:00:03Z'
    WHERE order_id='order-fixture';
    RAISE EXCEPTION 'ORDER_SNAPSHOT_IMMUTABILITY_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Order lines cannot be modified after pricing.
  BEGIN
    UPDATE order_lines SET quantity=3 WHERE order_line_id='order-line-fixture';
    RAISE EXCEPTION 'ORDER_LINE_IMMUTABILITY_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Payment must match a positive payable Order.
  BEGIN
    INSERT INTO payments (
      payment_id, order_id, customer_id, provider, merchant_id,
      amount_minor, currency, status, version, idempotency_key, request_hash,
      created_at, updated_at
    ) VALUES (
      'pay_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'order-fixture', 'customer-fixture',
      'hyperswitch', 'merchant-fixture', 949, 'USD', 'INITIATING', 1,
      'payment-fixture-wrong-amount', repeat('e',64), now(), now()
    );
    RAISE EXCEPTION 'PAYMENT_ORDER_SNAPSHOT_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Only one live/successful payment attempt is allowed per Order.
  BEGIN
    INSERT INTO payments (
      payment_id, order_id, customer_id, provider, merchant_id,
      amount_minor, currency, status, version, idempotency_key, request_hash,
      created_at, updated_at
    ) VALUES (
      'pay_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'order-fixture', 'customer-fixture',
      'hyperswitch', 'merchant-fixture', 950, 'USD', 'INITIATING', 1,
      'payment-fixture-second-live', repeat('f',64), now(), now()
    );
    RAISE EXCEPTION 'SINGLE_LIVE_PAYMENT_INDEX_NOT_ENFORCED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Provider conflict must refer to the first immutable receipt.
  BEGIN
    INSERT INTO payment_provider_event_conflicts (
      conflict_id, provider, merchant_id, event_id,
      existing_payload_sha256, incoming_payload_sha256, state,
      occurrence_count, version, first_seen_at, last_seen_at
    ) VALUES (
      'provider-conflict-without-receipt', 'hyperswitch', 'merchant-fixture',
      'unknown-event', repeat('1',64), repeat('2',64), 'OPEN',
      1, 1, now(), now()
    );
    RAISE EXCEPTION 'PROVIDER_CONFLICT_FIRST_RECEIPT_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

-- Exercise permitted monotonic transitions, then assert terminal immutability.
UPDATE orders
SET status='PENDING_PAYMENT', version=2, updated_at=TIMESTAMPTZ '2026-11-01T00:00:04Z'
WHERE order_id='order-fixture';

UPDATE payments
SET status='succeeded', version=2,
    provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z',
    updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z'
WHERE payment_id='pay_aaaaaaaaaaaaaaaaaaaaaaaaaa';

DO $$
BEGIN
  BEGIN
    UPDATE payments
    SET status='failed', version=3,
        provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:06Z',
        updated_at=TIMESTAMPTZ '2026-11-01T00:00:06Z'
    WHERE payment_id='pay_aaaaaaaaaaaaaaaaaaaaaaaaaa';
    RAISE EXCEPTION 'PAYMENT_TERMINAL_STATUS_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

UPDATE payment_provider_events
SET state='APPLIED', processed_at=TIMESTAMPTZ '2026-11-01T00:00:06Z',
    outcome_code='verified_payment_applied'
WHERE event_row_id='provider-event-fixture';

DO $$
BEGIN
  BEGIN
    UPDATE payment_provider_events
    SET outcome_code='rewritten'
    WHERE event_row_id='provider-event-fixture';
    RAISE EXCEPTION 'PROVIDER_EVENT_TERMINAL_IMMUTABILITY_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

UPDATE payment_provider_event_conflicts
SET occurrence_count=2, version=2,
    last_seen_at=TIMESTAMPTZ '2026-11-01T00:00:07Z'
WHERE conflict_id='provider-conflict-fixture';

UPDATE payment_provider_event_conflicts
SET state='RESOLVED', version=3,
    resolved_at=TIMESTAMPTZ '2026-11-01T00:00:08Z',
    resolution_code='manual_reconciled'
WHERE conflict_id='provider-conflict-fixture';

DO $$
BEGIN
  BEGIN
    UPDATE payment_provider_event_conflicts
    SET occurrence_count=3, version=4,
        last_seen_at=TIMESTAMPTZ '2026-11-01T00:00:09Z'
    WHERE conflict_id='provider-conflict-fixture';
    RAISE EXCEPTION 'RESOLVED_PROVIDER_CONFLICT_IMMUTABILITY_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM payments WHERE payment_id='pay_aaaaaaaaaaaaaaaaaaaaaaaaaa';
    RAISE EXCEPTION 'PAYMENT_FINANCIAL_RETENTION_NOT_ENFORCED';
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
    (SELECT count(*) FROM payment_provider_event_conflicts)
  INTO remaining_rows;
  IF remaining_rows <> 0 THEN
    RAISE EXCEPTION 'W07_D104_ROLLBACK_LEFT_%_FIXTURE_ROWS', remaining_rows;
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'database', current_database(),
  'postgresMajor', 18,
  'tables', 6,
  'explicitIndexes', 14,
  'triggers', 24,
  'triggerFunctions', 1,
  'foreignKeys', 0,
  'laterFinanceTablesIncluded', false,
  'rowsAfterRollback', 0,
  'businessDataImported', false,
  'remoteNeonTouched', false,
  'cloudflareD1Touched', false
) AS d1_04_w07_order_payment_postflight;
