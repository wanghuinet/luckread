\\set ON_ERROR_STOP on

-- PAY-006 D1-04 W07 refunds/billing PostgreSQL 18 cumulative local postflight.
-- Disposable local database only; no Neon or Cloudflare D1 connection.

DO $$
DECLARE table_count BIGINT; index_count BIGINT; trigger_count BIGINT; function_count BIGINT; fk_count BIGINT; forbidden_count BIGINT; scheduler_rows BIGINT;
BEGIN
 IF current_setting('server_version_num')::INTEGER/10000<>18 THEN RAISE EXCEPTION 'PAY006_EXPECTED_POSTGRESQL_18'; END IF;
 SELECT count(*) INTO table_count FROM information_schema.tables
 WHERE table_schema=current_schema() AND table_type='BASE TABLE'
 AND table_name=ANY(ARRAY['orders','order_lines','order_create_idempotency','payments','payment_provider_events','payment_provider_event_conflicts','saved_payment_methods','payment_mandates','subscription_renewal_cycles','subscription_renewal_scheduler_state','revenuecat_webhook_events','revenuecat_webhook_event_conflicts','refunds','billing_documents']);
 IF table_count<>14 THEN RAISE EXCEPTION 'PAY006_EXPECTED_14_TABLES_GOT_%',table_count; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' AND table_name=ANY(ARRAY['payment_method_revocation_requests','entitlements','ledger_entries','payment_intents','users','media'])) THEN
  RAISE EXCEPTION 'PAY006_UNEXPECTED_DEFERRED_OR_CROSS_DOMAIN_TABLE';
 END IF;
 SELECT count(*) INTO index_count FROM pg_indexes WHERE schemaname=current_schema()
 AND indexname=ANY(ARRAY[
 'ix_orders_customer_created_order','ix_orders_status_created_order','ix_order_lines_order_id','ix_order_lines_item_ref_version','ix_order_create_idempotency_customer_created','ix_order_create_idempotency_expiration',
 'ix_payments_customer_created_payment','ix_payments_order_created_payment','ix_payments_status_updated_payment','ux_payments_single_live_or_successful_per_order','ix_payment_provider_events_state_received','ix_payment_provider_events_payment_received','ix_payment_provider_event_conflicts_state_last_seen','ix_payment_provider_event_conflicts_identity',
 'ix_saved_payment_methods_customer_created','ux_payment_mandates_provider_mandate_id','ix_payment_mandates_customer_status_created','ix_payment_mandates_method_status',
 'ux_subscription_renewal_cycles_subscription_cycle','ux_subscription_renewal_cycles_payment','ix_subscription_renewal_cycles_state_updated','ix_subscription_renewal_cycles_subscriber_cycle',
 'ix_revenuecat_webhook_events_state_received','ix_revenuecat_webhook_events_user_received','ix_revenuecat_webhook_conflicts_event',
 'ix_refunds_customer_created','ix_refunds_payment_created','ix_refunds_status_updated','ix_billing_documents_customer_issued']);
 IF index_count<>29 THEN RAISE EXCEPTION 'PAY006_EXPECTED_29_EXPLICIT_INDEXES_GOT_%',index_count; END IF;
 SELECT count(*) INTO trigger_count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND NOT t.tgisinternal
 AND t.tgname=ANY(ARRAY[
 'orders_commercial_snapshot_immutable','orders_version_must_advance','orders_status_transition_guard','orders_retained','order_lines_require_order','order_lines_immutable_update','order_lines_retained','orders_require_matching_completed_idempotency','order_create_idempotency_identity_immutable','order_create_idempotency_terminal_immutable',
 'payments_require_payable_order','payments_snapshot_immutable','payments_version_must_advance','payments_terminal_status_guard','payments_provider_timestamp_monotonic','payments_retained','payment_provider_events_identity_immutable','payment_provider_events_terminal_immutable','payment_provider_events_retained','payment_provider_event_conflicts_reference_first_receipt','payment_provider_event_conflicts_identity_immutable','payment_provider_event_conflicts_version_guard','payment_provider_event_conflicts_resolved_immutable','payment_provider_event_conflicts_retained',
 'saved_payment_methods_require_succeeded_payment','saved_payment_methods_customer_binding_guard','saved_payment_methods_identity_immutable','saved_payment_methods_retained','payment_mandates_require_saved_method','payment_mandates_start_pending','payment_mandates_identity_immutable','payment_mandates_version_guard','payment_mandates_transition_guard','payment_mandates_provider_id_immutable','payment_mandates_provider_timestamp_monotonic','payment_mandates_retained',
 'subscription_renewal_cycles_initial_state_guard','subscription_renewal_cycles_identity_immutable','subscription_renewal_cycles_resolved_snapshot_immutable','subscription_renewal_cycles_version_guard','subscription_renewal_cycles_state_transition_guard','subscription_renewal_cycles_sync_state_transition_guard','subscription_renewal_cycles_order_binding_guard','subscription_renewal_cycles_payment_binding_guard','subscription_renewal_cycles_requires_active_mandate','subscription_renewal_cycles_retained','subscription_renewal_scheduler_state_identity_immutable','subscription_renewal_scheduler_state_version_guard','subscription_renewal_scheduler_state_retained',
 'revenuecat_webhook_events_identity_immutable','revenuecat_webhook_events_terminal_immutable','revenuecat_webhook_events_retained','revenuecat_webhook_conflicts_reference_first_receipt','revenuecat_webhook_conflicts_identity_immutable','revenuecat_webhook_conflicts_occurrence_guard','revenuecat_webhook_conflicts_retained',
 'refunds_require_captured_payment','refunds_identity_immutable','refunds_version_guard','refunds_state_transition_guard','refunds_provider_timestamp_monotonic','refunds_retained','billing_documents_source_guard','billing_documents_identity_immutable','billing_documents_retained']);
 IF trigger_count<>65 THEN RAISE EXCEPTION 'PAY006_EXPECTED_65_SOURCE_TRIGGERS_GOT_%',trigger_count; END IF;
 SELECT count(*) INTO function_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.proname=ANY(ARRAY['w07_d104_order_payment_source_guard','w07_d104_saved_mandate_source_guard','w07_d104_renewal_cycles_source_guard','w07_d104_revenuecat_inbox_source_guard','w07_d104_refunds_billing_source_guard']);
 IF function_count<>5 THEN RAISE EXCEPTION 'PAY006_EXPECTED_5_TRIGGER_FUNCTIONS_GOT_%',function_count; END IF;
 SELECT count(*) INTO fk_count FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND con.contype='f' AND c.relname=ANY(ARRAY['orders','order_lines','order_create_idempotency','payments','payment_provider_events','payment_provider_event_conflicts','saved_payment_methods','payment_mandates','subscription_renewal_cycles','subscription_renewal_scheduler_state','revenuecat_webhook_events','revenuecat_webhook_event_conflicts','refunds','billing_documents']);
 IF fk_count<>0 THEN RAISE EXCEPTION 'PAY006_EXPECTED_ZERO_FOREIGN_KEYS_GOT_%',fk_count; END IF;
 SELECT count(*) INTO forbidden_count FROM information_schema.columns
 WHERE table_schema=current_schema() AND table_name=ANY(ARRAY['refunds','billing_documents'])
 AND lower(column_name)=ANY(ARRAY['pan','card_number','cvc','cvv','raw_body','client_secret','api_key','secret_key']);
 IF forbidden_count<>0 THEN RAISE EXCEPTION 'PAY006_FORBIDDEN_SENSITIVE_COLUMNS_%',forbidden_count; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
  WHERE c.relname='payment_provider_events' AND con.contype='c' AND pg_get_constraintdef(con.oid) ILIKE '%hyperswitch%') THEN
  RAISE EXCEPTION 'PAY006_HYPERSWITCH_PROVIDER_BOUNDARY_MISSING';
 END IF;
 SELECT count(*) INTO scheduler_rows FROM subscription_renewal_scheduler_state
 WHERE state_id='subscription-renewals' AND cursor_period_end IS NULL AND cursor_subscription_id IS NULL AND version=1;
 IF scheduler_rows<>1 OR (SELECT count(*) FROM subscription_renewal_scheduler_state)<>1 THEN RAISE EXCEPTION 'PAY006_SCHEDULER_CONTROL_ROW_NOT_PRESERVED'; END IF;
END;
$$;

BEGIN;
INSERT INTO order_create_idempotency(id,customer_id,operation_key,idempotency_key,request_hash,state,response_status,response_json,created_at,expires_at)
VALUES('idem-pay006','customer-pay006','POST /v1/commerce/orders','order-key-pay006',repeat('a',64),'COMPLETED',201,'{"orderId":"order-pay006"}',TIMESTAMPTZ '2026-11-08T00:00:00Z',TIMESTAMPTZ '2026-11-09T00:00:00Z');
INSERT INTO orders(order_id,customer_id,status,version,currency,subtotal_minor,discount_minor,tax_minor,total_minor,created_at,updated_at)
VALUES('order-pay006','customer-pay006','CREATED',1,'USD',1000,100,50,950,TIMESTAMPTZ '2026-11-08T00:00:00Z',TIMESTAMPTZ '2026-11-08T00:00:00Z');
INSERT INTO payments(payment_id,order_id,customer_id,provider,merchant_id,amount_minor,currency,status,version,idempotency_key,request_hash,provider_updated_at,failure_code,created_at,updated_at)
VALUES('pay_aaaaaaaaaaaaaaaaaaaaaaaaaa','order-pay006','customer-pay006','hyperswitch','merchant-pay006',950,'USD','INITIATING',1,'payment-key-pay006',repeat('b',64),NULL,NULL,TIMESTAMPTZ '2026-11-08T00:00:00Z',TIMESTAMPTZ '2026-11-08T00:00:00Z');
INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code)
VALUES('event-pay006','hyperswitch','merchant-pay006','event-id-pay006','payment_succeeded','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('c',64),'RECEIVED',TIMESTAMPTZ '2026-11-08T00:00:01Z',NULL,NULL);
UPDATE orders SET status='PENDING_PAYMENT',version=2,updated_at=TIMESTAMPTZ '2026-11-08T00:00:02Z' WHERE order_id='order-pay006';
UPDATE payments SET status='succeeded',version=2,provider_updated_at=TIMESTAMPTZ '2026-11-08T00:00:03Z',updated_at=TIMESTAMPTZ '2026-11-08T00:00:03Z' WHERE payment_id='pay_aaaaaaaaaaaaaaaaaaaaaaaaaa';

INSERT INTO refunds(refund_id,provider,merchant_id,customer_id,order_id,payment_id,amount_minor,captured_amount_minor,currency,status,reason,idempotency_key,request_hash,provider_updated_at,outcome_code,version,created_at,updated_at)
VALUES('ref_aaaaaaaaaaaaaaaaaaaaaaaaaa','hyperswitch','merchant-pay006','customer-pay006','order-pay006','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',100,950,'USD','REQUESTED','customer-request','refund-key-pay006',repeat('d',64),NULL,NULL,1,TIMESTAMPTZ '2026-11-08T00:00:04Z',TIMESTAMPTZ '2026-11-08T00:00:04Z');
INSERT INTO billing_documents(document_id,document_type,document_number,customer_id,order_id,payment_id,amount_minor,currency,snapshot_json,issued_at,created_at)
VALUES('invoice-pay006','INVOICE','INV-PAY006','customer-pay006','order-pay006',NULL,950,'USD','{"kind":"INVOICE","amountMinor":950}',TIMESTAMPTZ '2026-11-08T00:00:05Z',TIMESTAMPTZ '2026-11-08T00:00:05Z');
INSERT INTO billing_documents(document_id,document_type,document_number,customer_id,order_id,payment_id,amount_minor,currency,snapshot_json,issued_at,created_at)
VALUES('receipt-pay006','RECEIPT','REC-PAY006','customer-pay006','order-pay006','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',950,'USD','{"kind":"RECEIPT","paymentId":"pay_aaaaaaaaaaaaaaaaaaaaaaaaaa"}',TIMESTAMPTZ '2026-11-08T00:00:05Z',TIMESTAMPTZ '2026-11-08T00:00:05Z');

DO $$
BEGIN
 -- Amount must fit inside captured amount less every non-FAILED existing refund.
 BEGIN
  INSERT INTO refunds(refund_id,provider,merchant_id,customer_id,order_id,payment_id,amount_minor,captured_amount_minor,currency,status,idempotency_key,request_hash,version,created_at,updated_at)
  VALUES('ref_bbbbbbbbbbbbbbbbbbbbbbbbbb','hyperswitch','merchant-pay006','customer-pay006','order-pay006','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',851,950,'USD','REQUESTED','refund-overrun',repeat('e',64),1,TIMESTAMPTZ '2026-11-08T00:00:06Z',TIMESTAMPTZ '2026-11-08T00:00:06Z');
  RAISE EXCEPTION 'PAY006_OVER_REFUND_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- The same idempotency key cannot be reused for a second refund.
 BEGIN
  INSERT INTO refunds(refund_id,provider,merchant_id,customer_id,order_id,payment_id,amount_minor,captured_amount_minor,currency,status,idempotency_key,request_hash,version,created_at,updated_at)
  VALUES('ref_bbbbbbbbbbbbbbbbbbbbbbbbbb','hyperswitch','merchant-pay006','customer-pay006','order-pay006','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',10,950,'USD','REQUESTED','refund-key-pay006',repeat('e',64),1,TIMESTAMPTZ '2026-11-08T00:00:06Z',TIMESTAMPTZ '2026-11-08T00:00:06Z');
  RAISE EXCEPTION 'PAY006_IDEMPOTENCY_REUSE_NOT_REJECTED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 -- A mismatched merchant/customer/order/payment identity is rejected.
 BEGIN
  INSERT INTO refunds(refund_id,provider,merchant_id,customer_id,order_id,payment_id,amount_minor,captured_amount_minor,currency,status,idempotency_key,request_hash,version,created_at,updated_at)
  VALUES('ref_bbbbbbbbbbbbbbbbbbbbbbbbbb','hyperswitch','merchant-other','customer-pay006','order-pay006','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',10,950,'USD','REQUESTED','refund-wrong-owner',repeat('e',64),1,TIMESTAMPTZ '2026-11-08T00:00:06Z',TIMESTAMPTZ '2026-11-08T00:00:06Z');
  RAISE EXCEPTION 'PAY006_WRONG_MERCHANT_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Exact one-step version advance is required.
 BEGIN
  UPDATE refunds SET version=3,updated_at=TIMESTAMPTZ '2026-11-08T00:00:06Z' WHERE refund_id='ref_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY006_VERSION_SKIP_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Commercial identity is immutable.
 BEGIN
  UPDATE refunds SET reason='rewritten',version=2,updated_at=TIMESTAMPTZ '2026-11-08T00:00:06Z' WHERE refund_id='ref_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY006_REFUND_IDENTITY_MUTATION_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Receipt requires the exact succeeded payment; mismatched amount is rejected.
 BEGIN
  INSERT INTO billing_documents(document_id,document_type,document_number,customer_id,order_id,payment_id,amount_minor,currency,snapshot_json,issued_at,created_at)
  VALUES('receipt-bad-pay006','RECEIPT','REC-BAD-PAY006','customer-pay006','order-pay006','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',949,'USD','{}',TIMESTAMPTZ '2026-11-08T00:00:06Z',TIMESTAMPTZ '2026-11-08T00:00:06Z');
  RAISE EXCEPTION 'PAY006_BAD_RECEIPT_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Issued documents are immutable and retained.
 BEGIN
  UPDATE billing_documents SET document_number='INV-REWRITTEN' WHERE document_id='invoice-pay006';
  RAISE EXCEPTION 'PAY006_BILLING_DOCUMENT_UPDATE_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  DELETE FROM billing_documents WHERE document_id='invoice-pay006';
  RAISE EXCEPTION 'PAY006_BILLING_DOCUMENT_DELETE_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;

UPDATE refunds SET status='PENDING',version=2,provider_updated_at=TIMESTAMPTZ '2026-11-08T00:00:07Z',updated_at=TIMESTAMPTZ '2026-11-08T00:00:07Z'
WHERE refund_id='ref_aaaaaaaaaaaaaaaaaaaaaaaaaa';
UPDATE refunds SET status='SUCCEEDED',version=3,provider_updated_at=TIMESTAMPTZ '2026-11-08T00:00:08Z',updated_at=TIMESTAMPTZ '2026-11-08T00:00:08Z'
WHERE refund_id='ref_aaaaaaaaaaaaaaaaaaaaaaaaaa';

DO $$
BEGIN
 BEGIN
  UPDATE refunds SET status='FAILED',version=4,provider_updated_at=TIMESTAMPTZ '2026-11-08T00:00:09Z',updated_at=TIMESTAMPTZ '2026-11-08T00:00:09Z'
  WHERE refund_id='ref_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY006_TERMINAL_REFUND_TRANSITION_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE refunds SET provider_updated_at=TIMESTAMPTZ '2026-11-08T00:00:07Z',version=4,updated_at=TIMESTAMPTZ '2026-11-08T00:00:09Z'
  WHERE refund_id='ref_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY006_PROVIDER_TIMESTAMP_REVERSAL_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  DELETE FROM refunds WHERE refund_id='ref_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY006_REFUND_RETENTION_NOT_ENFORCED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;

ROLLBACK;

DO $$
DECLARE business_rows BIGINT; scheduler_rows BIGINT;
BEGIN
 SELECT (SELECT count(*) FROM orders)+(SELECT count(*) FROM order_lines)+(SELECT count(*) FROM order_create_idempotency)
 +(SELECT count(*) FROM payments)+(SELECT count(*) FROM payment_provider_events)+(SELECT count(*) FROM payment_provider_event_conflicts)
 +(SELECT count(*) FROM saved_payment_methods)+(SELECT count(*) FROM payment_mandates)+(SELECT count(*) FROM subscription_renewal_cycles)
 +(SELECT count(*) FROM revenuecat_webhook_events)+(SELECT count(*) FROM revenuecat_webhook_event_conflicts)
 +(SELECT count(*) FROM refunds)+(SELECT count(*) FROM billing_documents) INTO business_rows;
 SELECT count(*) INTO scheduler_rows FROM subscription_renewal_scheduler_state
 WHERE state_id='subscription-renewals' AND cursor_period_end IS NULL AND cursor_subscription_id IS NULL AND version=1;
 IF business_rows<>0 OR scheduler_rows<>1 OR (SELECT count(*) FROM subscription_renewal_scheduler_state)<>1 THEN
  RAISE EXCEPTION 'PAY006_ROLLBACK_INVARIANT_FAILED_BUSINESS_ROWS_%_SCHEDULER_ROWS_%',business_rows,scheduler_rows;
 END IF;
END;
$$;

SELECT jsonb_build_object('database',current_database(),'postgresMajor',18,'tables',14,'explicitIndexes',29,'triggers',65,'triggerFunctions',5,'foreignKeys',0,'refundsBillingFixturesAfterRollback',0,'schedulerControlRowsAfterRollback',1,'remoteNeonTouched',false,'cloudflareD1Touched',false,'businessDataImported',false,'productionCutoverAuthorized',false) AS d1_04_w07_refunds_billing_postflight;
