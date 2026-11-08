\set ON_ERROR_STOP on

-- PAY-007 D1-04 W07 payment-method revocation PostgreSQL 18 cumulative postflight.
-- Disposable local database only; no remote Neon or Cloudflare D1 connection.

DO $$
DECLARE table_count BIGINT; index_count BIGINT; trigger_count BIGINT; function_count BIGINT; fk_count BIGINT; scheduler_rows BIGINT; forbidden_count BIGINT;
BEGIN
 IF current_setting('server_version_num')::INTEGER/10000<>18 THEN RAISE EXCEPTION 'PAY007_EXPECTED_POSTGRESQL_18'; END IF;
 SELECT count(*) INTO table_count FROM information_schema.tables
 WHERE table_schema=current_schema() AND table_type='BASE TABLE'
 AND table_name=ANY(ARRAY['orders','order_lines','order_create_idempotency','payments','payment_provider_events','payment_provider_event_conflicts','saved_payment_methods','payment_mandates','subscription_renewal_cycles','subscription_renewal_scheduler_state','revenuecat_webhook_events','revenuecat_webhook_event_conflicts','refunds','billing_documents','payment_method_revocation_requests']);
 IF table_count<>15 THEN RAISE EXCEPTION 'PAY007_EXPECTED_15_TABLES_GOT_%',table_count; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' AND table_name=ANY(ARRAY['entitlements','ledger_entries','payment_intents','users','media'])) THEN
  RAISE EXCEPTION 'PAY007_UNEXPECTED_CROSS_DOMAIN_TABLE';
 END IF;
 SELECT count(*) INTO index_count FROM pg_indexes WHERE schemaname=current_schema()
 AND indexname=ANY(ARRAY[
 'ix_orders_customer_created_order','ix_orders_status_created_order','ix_order_lines_order_id','ix_order_lines_item_ref_version','ix_order_create_idempotency_customer_created','ix_order_create_idempotency_expiration',
 'ix_payments_customer_created_payment','ix_payments_order_created_payment','ix_payments_status_updated_payment','ux_payments_single_live_or_successful_per_order','ix_payment_provider_events_state_received','ix_payment_provider_events_payment_received','ix_payment_provider_event_conflicts_state_last_seen','ix_payment_provider_event_conflicts_identity',
 'ix_saved_payment_methods_customer_created','ux_payment_mandates_provider_mandate_id','ix_payment_mandates_customer_status_created','ix_payment_mandates_method_status',
 'ux_subscription_renewal_cycles_subscription_cycle','ux_subscription_renewal_cycles_payment','ix_subscription_renewal_cycles_state_updated','ix_subscription_renewal_cycles_subscriber_cycle',
 'ix_revenuecat_webhook_events_state_received','ix_revenuecat_webhook_events_user_received','ix_revenuecat_webhook_conflicts_event',
 'ix_refunds_customer_created','ix_refunds_payment_created','ix_refunds_status_updated','ix_billing_documents_customer_issued',
 'ix_payment_method_revocation_status','ux_payment_method_revocation_customer_idempotency']);
 IF index_count<>31 THEN RAISE EXCEPTION 'PAY007_EXPECTED_31_EXPLICIT_INDEXES_GOT_%',index_count; END IF;
 SELECT count(*) INTO trigger_count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND NOT t.tgisinternal
 AND t.tgname=ANY(ARRAY[
 'orders_commercial_snapshot_immutable','orders_version_must_advance','orders_status_transition_guard','orders_retained','order_lines_require_order','order_lines_immutable_update','order_lines_retained','orders_require_matching_completed_idempotency','order_create_idempotency_identity_immutable','order_create_idempotency_terminal_immutable',
 'payments_require_payable_order','payments_snapshot_immutable','payments_version_must_advance','payments_terminal_status_guard','payments_provider_timestamp_monotonic','payments_retained','payment_provider_events_identity_immutable','payment_provider_events_terminal_immutable','payment_provider_events_retained','payment_provider_event_conflicts_reference_first_receipt','payment_provider_event_conflicts_identity_immutable','payment_provider_event_conflicts_version_guard','payment_provider_event_conflicts_resolved_immutable','payment_provider_event_conflicts_retained',
 'saved_payment_methods_require_succeeded_payment','saved_payment_methods_customer_binding_guard','saved_payment_methods_identity_immutable','saved_payment_methods_retained','payment_mandates_require_saved_method','payment_mandates_start_pending','payment_mandates_identity_immutable','payment_mandates_version_guard','payment_mandates_transition_guard','payment_mandates_provider_id_immutable','payment_mandates_provider_timestamp_monotonic','payment_mandates_retained',
 'subscription_renewal_cycles_initial_state_guard','subscription_renewal_cycles_identity_immutable','subscription_renewal_cycles_resolved_snapshot_immutable','subscription_renewal_cycles_version_guard','subscription_renewal_cycles_state_transition_guard','subscription_renewal_cycles_sync_state_transition_guard','subscription_renewal_cycles_order_binding_guard','subscription_renewal_cycles_payment_binding_guard','subscription_renewal_cycles_requires_active_mandate','subscription_renewal_cycles_retained','subscription_renewal_scheduler_state_identity_immutable','subscription_renewal_scheduler_state_version_guard','subscription_renewal_scheduler_state_retained',
 'revenuecat_webhook_events_identity_immutable','revenuecat_webhook_events_terminal_immutable','revenuecat_webhook_events_retained','revenuecat_webhook_conflicts_reference_first_receipt','revenuecat_webhook_conflicts_identity_immutable','revenuecat_webhook_conflicts_occurrence_guard','revenuecat_webhook_conflicts_retained',
 'refunds_require_captured_payment','refunds_identity_immutable','refunds_version_guard','refunds_state_transition_guard','refunds_provider_timestamp_monotonic','refunds_retained','billing_documents_source_guard','billing_documents_identity_immutable','billing_documents_retained',
 'payment_method_revocation_request_requires_saved_method','payment_method_revocation_request_identity_immutable','payment_method_revocation_request_version_guard','payment_method_revocation_request_transition_guard','payment_method_revocation_request_provider_deleted_immutable','payment_method_revocation_request_retained','payment_method_revocation_request_completion_guard']);
 IF trigger_count<>72 THEN RAISE EXCEPTION 'PAY007_EXPECTED_72_SOURCE_TRIGGERS_GOT_%',trigger_count; END IF;
 SELECT count(*) INTO function_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.proname=ANY(ARRAY['w07_d104_order_payment_source_guard','w07_d104_saved_mandate_source_guard','w07_d104_renewal_cycles_source_guard','w07_d104_revenuecat_inbox_source_guard','w07_d104_refunds_billing_source_guard','w07_d104_payment_method_revocation_source_guard']);
 IF function_count<>6 THEN RAISE EXCEPTION 'PAY007_EXPECTED_6_TRIGGER_FUNCTIONS_GOT_%',function_count; END IF;
 SELECT count(*) INTO fk_count FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND con.contype='f' AND c.relname=ANY(ARRAY['orders','order_lines','order_create_idempotency','payments','payment_provider_events','payment_provider_event_conflicts','saved_payment_methods','payment_mandates','subscription_renewal_cycles','subscription_renewal_scheduler_state','revenuecat_webhook_events','revenuecat_webhook_event_conflicts','refunds','billing_documents','payment_method_revocation_requests']);
 IF fk_count<>0 THEN RAISE EXCEPTION 'PAY007_EXPECTED_ZERO_FOREIGN_KEYS_GOT_%',fk_count; END IF;
 SELECT count(*) INTO forbidden_count FROM information_schema.columns
 WHERE table_schema=current_schema() AND table_name='payment_method_revocation_requests'
 AND lower(column_name)=ANY(ARRAY['pan','card_number','cvc','cvv','raw_body','client_secret','api_key','secret_key']);
 IF forbidden_count<>0 THEN RAISE EXCEPTION 'PAY007_FORBIDDEN_SENSITIVE_COLUMNS_%',forbidden_count; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=current_schema() AND c.relname='payment_provider_events' AND t.tgname='payment_provider_events_terminal_immutable'
  AND pg_get_triggerdef(t.oid) ILIKE '%w07_d104_payment_method_revocation_source_guard%') THEN
  RAISE EXCEPTION 'PAY007_MANDATE_REPLAY_TERMINAL_TRIGGER_NOT_REPLACED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='payment_method_revocation_requests' AND column_name='version' AND data_type='bigint')
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='payment_method_revocation_requests' AND column_name='provider_method_deleted_at' AND data_type='timestamp with time zone') THEN
  RAISE EXCEPTION 'PAY007_POSTGRES_NATIVE_TYPES_MISSING';
 END IF;
 SELECT count(*) INTO scheduler_rows FROM subscription_renewal_scheduler_state WHERE state_id='subscription-renewals' AND cursor_period_end IS NULL AND cursor_subscription_id IS NULL AND version=1;
 IF scheduler_rows<>1 OR (SELECT count(*) FROM subscription_renewal_scheduler_state)<>1 THEN RAISE EXCEPTION 'PAY007_SCHEDULER_CONTROL_ROW_NOT_PRESERVED'; END IF;
END;
$$;

BEGIN;
INSERT INTO order_create_idempotency(id,customer_id,operation_key,idempotency_key,request_hash,state,response_status,response_json,created_at,expires_at)
VALUES('idem-pay007','customer-pay007','POST /v1/commerce/orders','order-key-pay007',repeat('a',64),'COMPLETED',201,'{"orderId":"order-pay007"}',TIMESTAMPTZ '2026-11-08T00:00:00Z',TIMESTAMPTZ '2026-11-09T00:00:00Z');
INSERT INTO orders(order_id,customer_id,status,version,currency,subtotal_minor,discount_minor,tax_minor,total_minor,created_at,updated_at)
VALUES('order-pay007','customer-pay007','CREATED',1,'USD',1000,0,0,1000,TIMESTAMPTZ '2026-11-08T00:00:00Z',TIMESTAMPTZ '2026-11-08T00:00:00Z');
INSERT INTO payments(payment_id,order_id,customer_id,provider,merchant_id,amount_minor,currency,status,version,idempotency_key,request_hash,provider_updated_at,failure_code,created_at,updated_at)
VALUES('pay_aaaaaaaaaaaaaaaaaaaaaaaaaa','order-pay007','customer-pay007','hyperswitch','merchant-pay007',1000,'USD','INITIATING',1,'payment-key-pay007',repeat('b',64),NULL,NULL,TIMESTAMPTZ '2026-11-08T00:00:00Z',TIMESTAMPTZ '2026-11-08T00:00:00Z');
INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code)
VALUES('event-pay007','hyperswitch','merchant-pay007','event-id-pay007','payment_succeeded','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('c',64),'RECEIVED',TIMESTAMPTZ '2026-11-08T00:00:01Z',NULL,NULL);
UPDATE orders SET status='PENDING_PAYMENT',version=2,updated_at=TIMESTAMPTZ '2026-11-08T00:00:02Z' WHERE order_id='order-pay007';
UPDATE payments SET status='succeeded',version=2,provider_updated_at=TIMESTAMPTZ '2026-11-08T00:00:03Z',updated_at=TIMESTAMPTZ '2026-11-08T00:00:03Z' WHERE payment_id='pay_aaaaaaaaaaaaaaaaaaaaaaaaaa';

INSERT INTO saved_payment_methods(saved_payment_method_id,provider,merchant_id,customer_id,payment_method_id,source_payment_id,source_event_id,created_at)
VALUES('spm_aaaaaaaaaaaaaaaaaaaaaaaaaa','hyperswitch','merchant-pay007','customer-pay007','pm_pay007_primary','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa','event-id-pay007',TIMESTAMPTZ '2026-11-08T00:00:03Z');
INSERT INTO saved_payment_methods(saved_payment_method_id,provider,merchant_id,customer_id,payment_method_id,source_payment_id,source_event_id,created_at)
VALUES('spm_bbbbbbbbbbbbbbbbbbbbbbbbbb','hyperswitch','merchant-pay007','customer-pay007','pm_pay007_secondary','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa','event-id-pay007',TIMESTAMPTZ '2026-11-08T00:00:03Z');
INSERT INTO payment_mandates(mandate_record_id,provider,merchant_id,customer_id,payment_method_id,source_payment_id,source_event_id,consent_accepted_at,consent_acceptance_type,consent_scope,consent_terms_version,provider_mandate_id,status,version,provider_updated_at,created_at,updated_at)
VALUES('mnd_aaaaaaaaaaaaaaaaaaaaaaaaaa','hyperswitch','merchant-pay007','customer-pay007','pm_pay007_primary','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa','event-id-pay007',TIMESTAMPTZ '2026-11-08T00:00:03Z','online','OFF_SESSION_RECURRING','luckread-recurring-consent-v1','hyperswitch-mandate-pay007','PENDING_PROVIDER_CONFIRMATION',1,NULL,TIMESTAMPTZ '2026-11-08T00:00:03Z',TIMESTAMPTZ '2026-11-08T00:00:03Z');
UPDATE payment_mandates SET status='ACTIVE',version=2,provider_updated_at=TIMESTAMPTZ '2026-11-08T00:00:04Z',updated_at=TIMESTAMPTZ '2026-11-08T00:00:04Z'
WHERE mandate_record_id='mnd_aaaaaaaaaaaaaaaaaaaaaaaaaa';

INSERT INTO payment_method_revocation_requests(revocation_request_id,saved_payment_method_id,payment_method_id,provider,merchant_id,customer_id,idempotency_key,status,provider_method_deleted_at,version,created_at,updated_at)
VALUES('pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa','spm_aaaaaaaaaaaaaaaaaaaaaaaaaa','pm_pay007_primary','hyperswitch','merchant-pay007','customer-pay007','remove-primary','REQUESTED',NULL,1,TIMESTAMPTZ '2026-11-08T00:00:05Z',TIMESTAMPTZ '2026-11-08T00:00:05Z');

DO $$
BEGIN
 -- A mismatched provider/merchant/customer/token owner must not create a revocation request.
 BEGIN
  INSERT INTO payment_method_revocation_requests(revocation_request_id,saved_payment_method_id,payment_method_id,provider,merchant_id,customer_id,idempotency_key,status,version,created_at,updated_at)
  VALUES('pmr_bbbbbbbbbbbbbbbbbbbbbbbbbb','spm_aaaaaaaaaaaaaaaaaaaaaaaaaa','pm_pay007_primary','hyperswitch','merchant-other','customer-pay007','wrong-owner','REQUESTED',1,TIMESTAMPTZ '2026-11-08T00:00:06Z',TIMESTAMPTZ '2026-11-08T00:00:06Z');
  RAISE EXCEPTION 'PAY007_OWNER_BINDING_NOT_ENFORCED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- A request cannot be created for an absent saved-method identity.
 BEGIN
  INSERT INTO payment_method_revocation_requests(revocation_request_id,saved_payment_method_id,payment_method_id,provider,merchant_id,customer_id,idempotency_key,status,version,created_at,updated_at)
  VALUES('pmr_bbbbbbbbbbbbbbbbbbbbbbbbbb','spm_cccccccccccccccccccccccccc','pm_missing_pay007','hyperswitch','merchant-pay007','customer-pay007','missing-method','REQUESTED',1,TIMESTAMPTZ '2026-11-08T00:00:06Z',TIMESTAMPTZ '2026-11-08T00:00:06Z');
  RAISE EXCEPTION 'PAY007_MISSING_SAVED_METHOD_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Both one-request-per-saved-method and customer-scoped idempotency are enforced.
 BEGIN
  INSERT INTO payment_method_revocation_requests(revocation_request_id,saved_payment_method_id,payment_method_id,provider,merchant_id,customer_id,idempotency_key,status,version,created_at,updated_at)
  VALUES('pmr_bbbbbbbbbbbbbbbbbbbbbbbbbb','spm_aaaaaaaaaaaaaaaaaaaaaaaaaa','pm_pay007_primary','hyperswitch','merchant-pay007','customer-pay007','duplicate-saved-method','REQUESTED',1,TIMESTAMPTZ '2026-11-08T00:00:06Z',TIMESTAMPTZ '2026-11-08T00:00:06Z');
  RAISE EXCEPTION 'PAY007_DUPLICATE_SAVED_METHOD_NOT_REJECTED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO payment_method_revocation_requests(revocation_request_id,saved_payment_method_id,payment_method_id,provider,merchant_id,customer_id,idempotency_key,status,version,created_at,updated_at)
  VALUES('pmr_bbbbbbbbbbbbbbbbbbbbbbbbbb','spm_bbbbbbbbbbbbbbbbbbbbbbbbbb','pm_pay007_secondary','hyperswitch','merchant-pay007','customer-pay007','remove-primary','REQUESTED',1,TIMESTAMPTZ '2026-11-08T00:00:06Z',TIMESTAMPTZ '2026-11-08T00:00:06Z');
  RAISE EXCEPTION 'PAY007_CUSTOMER_IDEMPOTENCY_NOT_ENFORCED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 -- While a request is pending, the exact renewal mandate lookup must exclude it.
 IF EXISTS(
  SELECT 1 FROM payment_mandates m
  JOIN saved_payment_methods s ON s.provider=m.provider AND s.merchant_id=m.merchant_id AND s.customer_id=m.customer_id AND s.payment_method_id=m.payment_method_id
  WHERE m.mandate_record_id='mnd_aaaaaaaaaaaaaaaaaaaaaaaaaa' AND m.status='ACTIVE'
   AND NOT EXISTS(SELECT 1 FROM payment_method_revocation_requests r JOIN saved_payment_methods rs ON rs.saved_payment_method_id=r.saved_payment_method_id
    WHERE rs.provider=m.provider AND rs.merchant_id=m.merchant_id AND rs.customer_id=m.customer_id AND rs.payment_method_id=m.payment_method_id AND r.status<>'COMPLETED')
 ) THEN RAISE EXCEPTION 'PAY007_PENDING_REVOCATION_DID_NOT_BLOCK_RENEWAL_LOOKUP'; END IF;
 -- A completed request needs a recorded provider deletion timestamp.
 BEGIN
  UPDATE payment_method_revocation_requests SET status='COMPLETED',version=2,updated_at=TIMESTAMPTZ '2026-11-08T00:00:06Z'
  WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY007_COMPLETION_WITHOUT_PROVIDER_DELETE_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Move into provider-pending and record the immutable provider deletion acknowledgement.
 UPDATE payment_method_revocation_requests
 SET status='PENDING_PROVIDER',provider_method_deleted_at=TIMESTAMPTZ '2026-11-08T00:00:06Z',version=2,updated_at=TIMESTAMPTZ '2026-11-08T00:00:06Z'
 WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
 -- A method cannot be declared removed while any linked mandate remains active.
 BEGIN
  UPDATE payment_method_revocation_requests SET status='COMPLETED',version=3,updated_at=TIMESTAMPTZ '2026-11-08T00:00:07Z'
  WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY007_COMPLETION_WITH_ACTIVE_MANDATE_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Once acknowledged, provider deletion time cannot be changed or cleared.
 BEGIN
  UPDATE payment_method_revocation_requests SET provider_method_deleted_at=TIMESTAMPTZ '2026-11-08T00:00:07Z',version=3,updated_at=TIMESTAMPTZ '2026-11-08T00:00:07Z'
  WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY007_PROVIDER_DELETE_TIMESTAMP_MUTATION_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Identity and exact one-step CAS remain immutable.
 BEGIN
  UPDATE payment_method_revocation_requests SET idempotency_key='rewritten',version=3,updated_at=TIMESTAMPTZ '2026-11-08T00:00:07Z'
  WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY007_IDENTITY_MUTATION_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE payment_method_revocation_requests SET version=4,updated_at=TIMESTAMPTZ '2026-11-08T00:00:07Z'
  WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY007_VERSION_SKIP_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- A mandate event in reconciliation can be reopened; its first receipt hash remains immutable.
 INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code)
 VALUES('mandate-replay-pay007','hyperswitch','merchant-pay007','mandate-replay-event-pay007','mandate_revoked','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('d',64),'RECONCILIATION_REQUIRED',TIMESTAMPTZ '2026-11-08T00:00:05Z',TIMESTAMPTZ '2026-11-08T00:00:06Z','MANDATE_IDENTITY_MISMATCH');
 UPDATE payment_provider_events SET state='RECEIVED',processed_at=NULL,outcome_code=NULL
 WHERE event_row_id='mandate-replay-pay007';
 IF NOT EXISTS(SELECT 1 FROM payment_provider_events WHERE event_row_id='mandate-replay-pay007' AND state='RECEIVED' AND processed_at IS NULL AND outcome_code IS NULL AND payload_sha256=repeat('d',64)) THEN
  RAISE EXCEPTION 'PAY007_EXACT_MANDATE_REPLAY_NOT_ALLOWED';
 END IF;
 BEGIN
  UPDATE payment_provider_events SET payload_sha256=repeat('e',64)
  WHERE event_row_id='mandate-replay-pay007';
  RAISE EXCEPTION 'PAY007_REPLAY_PAYLOAD_HASH_MUTATION_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Applied, rejected and non-mandate reconciliation receipts remain immutable.
 INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code)
 VALUES('mandate-applied-pay007','hyperswitch','merchant-pay007','mandate-applied-event-pay007','mandate_active','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('1',64),'APPLIED',TIMESTAMPTZ '2026-11-08T00:00:05Z',TIMESTAMPTZ '2026-11-08T00:00:06Z','APPLIED');
 BEGIN
  UPDATE payment_provider_events SET state='RECEIVED',processed_at=NULL,outcome_code=NULL WHERE event_row_id='mandate-applied-pay007';
  RAISE EXCEPTION 'PAY007_APPLIED_RECEIPT_REOPENED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code)
 VALUES('mandate-rejected-pay007','hyperswitch','merchant-pay007','mandate-rejected-event-pay007','mandate_revoked','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('2',64),'REJECTED',TIMESTAMPTZ '2026-11-08T00:00:05Z',TIMESTAMPTZ '2026-11-08T00:00:06Z','REJECTED');
 BEGIN
  UPDATE payment_provider_events SET state='RECEIVED',processed_at=NULL,outcome_code=NULL WHERE event_row_id='mandate-rejected-pay007';
  RAISE EXCEPTION 'PAY007_REJECTED_RECEIPT_REOPENED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code)
 VALUES('payment-reconcile-pay007','hyperswitch','merchant-pay007','payment-reconcile-event-pay007','payment_succeeded','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('3',64),'RECONCILIATION_REQUIRED',TIMESTAMPTZ '2026-11-08T00:00:05Z',TIMESTAMPTZ '2026-11-08T00:00:06Z','PAYMENT_IDENTITY_MISMATCH');
 BEGIN
  UPDATE payment_provider_events SET state='RECEIVED',processed_at=NULL,outcome_code=NULL WHERE event_row_id='payment-reconcile-pay007';
  RAISE EXCEPTION 'PAY007_NON_MANDATE_RECEIPT_REOPENED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- The signed mandate truth is still owned by the provider event, not by the local request.
 UPDATE payment_mandates SET status='REVOKED',version=3,provider_updated_at=TIMESTAMPTZ '2026-11-08T00:00:08Z',updated_at=TIMESTAMPTZ '2026-11-08T00:00:08Z'
 WHERE mandate_record_id='mnd_aaaaaaaaaaaaaaaaaaaaaaaaaa';
 UPDATE payment_method_revocation_requests SET status='COMPLETED',version=3,updated_at=TIMESTAMPTZ '2026-11-08T00:00:09Z'
 WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
 IF NOT EXISTS(SELECT 1 FROM payment_method_revocation_requests WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa' AND status='COMPLETED' AND provider_method_deleted_at=TIMESTAMPTZ '2026-11-08T00:00:06Z') THEN
  RAISE EXCEPTION 'PAY007_VALID_COMPLETION_NOT_RECORDED';
 END IF;
 -- Completed is terminal and request records are retained.
 BEGIN
  UPDATE payment_method_revocation_requests SET status='PENDING_PROVIDER',version=4,updated_at=TIMESTAMPTZ '2026-11-08T00:00:10Z'
  WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY007_COMPLETED_REQUEST_REOPENED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  DELETE FROM payment_method_revocation_requests WHERE revocation_request_id='pmr_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  RAISE EXCEPTION 'PAY007_REQUEST_RETENTION_NOT_ENFORCED';
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
 +(SELECT count(*) FROM refunds)+(SELECT count(*) FROM billing_documents)+(SELECT count(*) FROM payment_method_revocation_requests)
 INTO business_rows;
 SELECT count(*) INTO scheduler_rows FROM subscription_renewal_scheduler_state
 WHERE state_id='subscription-renewals' AND cursor_period_end IS NULL AND cursor_subscription_id IS NULL AND version=1;
 IF business_rows<>0 OR scheduler_rows<>1 OR (SELECT count(*) FROM subscription_renewal_scheduler_state)<>1 THEN
  RAISE EXCEPTION 'PAY007_ROLLBACK_INVARIANT_FAILED_BUSINESS_ROWS_%_SCHEDULER_ROWS_%',business_rows,scheduler_rows;
 END IF;
END;
$$;

SELECT jsonb_build_object('database',current_database(),'postgresMajor',18,'tables',15,'explicitIndexes',31,'triggers',72,'triggerFunctions',6,'foreignKeys',0,'revocationRowsAfterRollback',0,'businessFixtureRowsAfterRollback',0,'schedulerControlRowsAfterRollback',1,'remoteNeonTouched',false,'cloudflareD1Touched',false,'businessDataImported',false,'productionCutoverAuthorized',false) AS d1_04_w07_payment_method_revocation_postflight;
