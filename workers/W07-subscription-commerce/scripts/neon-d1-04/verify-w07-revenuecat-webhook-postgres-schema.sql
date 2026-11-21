-- PAY-005 D1-04 W07 RevenueCat Webhook PostgreSQL 18 local postflight.
-- Disposable local database only. No Neon or Cloudflare D1 connections.

DO $$
DECLARE table_count BIGINT; index_count BIGINT; trigger_count BIGINT; function_count BIGINT; fk_count BIGINT; sensitive_column_count BIGINT;
BEGIN
 SELECT count(*) INTO table_count FROM pg_tables WHERE schemaname=current_schema()
 AND tablename=ANY(ARRAY['orders','order_lines','order_create_idempotency','payments','payment_provider_events','payment_provider_event_conflicts','saved_payment_methods','payment_mandates','subscription_renewal_cycles','subscription_renewal_scheduler_state','revenuecat_webhook_events','revenuecat_webhook_event_conflicts']);
 IF table_count<>12 THEN RAISE EXCEPTION 'PAY005_EXPECTED_12_TABLES_GOT_%',table_count; END IF;
 SELECT count(*) INTO index_count FROM pg_indexes WHERE schemaname=current_schema()
 AND indexname=ANY(ARRAY['ix_orders_customer_created_order','ix_orders_status_created_order','ix_order_lines_order_id','ix_order_lines_item_ref_version','ix_order_create_idempotency_customer_created','ix_order_create_idempotency_expiration','ix_payments_customer_created_payment','ix_payments_order_created_payment','ix_payments_status_updated_payment','ux_payments_single_live_or_successful_per_order','ix_payment_provider_events_state_received','ix_payment_provider_events_payment_received','ix_payment_provider_event_conflicts_state_last_seen','ix_payment_provider_event_conflicts_identity','ix_saved_payment_methods_customer_created','ux_payment_mandates_provider_mandate_id','ix_payment_mandates_customer_status_created','ix_payment_mandates_method_status','ux_subscription_renewal_cycles_subscription_cycle','ux_subscription_renewal_cycles_payment','ix_subscription_renewal_cycles_state_updated','ix_subscription_renewal_cycles_subscriber_cycle','ix_revenuecat_webhook_events_state_received','ix_revenuecat_webhook_events_user_received','ix_revenuecat_webhook_conflicts_event','ix_revenuecat_webhook_events_state_received','ix_revenuecat_webhook_events_user_received','ix_revenuecat_webhook_conflicts_event']);
 IF index_count<>25 THEN RAISE EXCEPTION 'PAY005_EXPECTED_25_EXPLICIT_INDEXES_GOT_%',index_count; END IF;
 SELECT count(*) INTO trigger_count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND NOT t.tgisinternal
 AND t.tgname=ANY(ARRAY['orders_commercial_snapshot_immutable','orders_version_must_advance','orders_status_transition_guard','orders_retained','order_lines_require_order','order_lines_immutable_update','order_lines_retained','orders_require_matching_completed_idempotency','order_create_idempotency_identity_immutable','order_create_idempotency_terminal_immutable','payments_require_payable_order','payments_snapshot_immutable','payments_version_must_advance','payments_terminal_status_guard','payments_provider_timestamp_monotonic','payments_retained','payment_provider_events_identity_immutable','payment_provider_events_terminal_immutable','payment_provider_events_retained','payment_provider_event_conflicts_reference_first_receipt','payment_provider_event_conflicts_identity_immutable','payment_provider_event_conflicts_version_guard','payment_provider_event_conflicts_resolved_immutable','payment_provider_event_conflicts_retained','saved_payment_methods_require_succeeded_payment','saved_payment_methods_customer_binding_guard','saved_payment_methods_identity_immutable','saved_payment_methods_retained','payment_mandates_require_saved_method','payment_mandates_start_pending','payment_mandates_identity_immutable','payment_mandates_version_guard','payment_mandates_transition_guard','payment_mandates_provider_id_immutable','payment_mandates_provider_timestamp_monotonic','payment_mandates_retained','subscription_renewal_cycles_initial_state_guard','subscription_renewal_cycles_identity_immutable','subscription_renewal_cycles_resolved_snapshot_immutable','subscription_renewal_cycles_version_guard','subscription_renewal_cycles_state_transition_guard','subscription_renewal_cycles_sync_state_transition_guard','subscription_renewal_cycles_order_binding_guard','subscription_renewal_cycles_payment_binding_guard','subscription_renewal_cycles_requires_active_mandate','subscription_renewal_cycles_retained','subscription_renewal_scheduler_state_identity_immutable','subscription_renewal_scheduler_state_version_guard','subscription_renewal_scheduler_state_retained','revenuecat_webhook_events_identity_immutable','revenuecat_webhook_events_terminal_immutable','revenuecat_webhook_events_retained','revenuecat_webhook_conflicts_reference_first_receipt','revenuecat_webhook_conflicts_identity_immutable','revenuecat_webhook_conflicts_occurrence_guard','revenuecat_webhook_conflicts_retained','revenuecat_webhook_events_identity_immutable','revenuecat_webhook_events_terminal_immutable','revenuecat_webhook_events_retained','revenuecat_webhook_conflicts_reference_first_receipt','revenuecat_webhook_conflicts_identity_immutable','revenuecat_webhook_conflicts_occurrence_guard','revenuecat_webhook_conflicts_retained']);
 IF trigger_count<>56 THEN RAISE EXCEPTION 'PAY005_EXPECTED_56_SOURCE_TRIGGERS_GOT_%',trigger_count; END IF;
 SELECT count(*) INTO function_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.proname=ANY(ARRAY['w07_d104_order_payment_source_guard','w07_d104_saved_mandate_source_guard','w07_d104_renewal_cycles_source_guard','w07_d104_revenuecat_inbox_source_guard']);
 IF function_count<>4 THEN RAISE EXCEPTION 'PAY005_EXPECTED_4_TRIGGER_FUNCTIONS_GOT_%',function_count; END IF;
 SELECT count(*) INTO fk_count FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND con.contype='f'
 AND c.relname=ANY(ARRAY['orders','order_lines','order_create_idempotency','payments','payment_provider_events','payment_provider_event_conflicts','saved_payment_methods','payment_mandates','subscription_renewal_cycles','subscription_renewal_scheduler_state','revenuecat_webhook_events','revenuecat_webhook_event_conflicts']);
 IF fk_count<>0 THEN RAISE EXCEPTION 'PAY005_EXPECTED_ZERO_FOREIGN_KEYS_GOT_%',fk_count; END IF;
 SELECT count(*) INTO sensitive_column_count FROM information_schema.columns
 WHERE table_schema=current_schema() AND table_name=ANY(ARRAY['revenuecat_webhook_events','revenuecat_webhook_event_conflicts'])
 AND column_name=ANY(ARRAY['raw_body','subscriber_attributes','pan','cvc','api_key','client_secret']);
 IF sensitive_column_count<>0 THEN RAISE EXCEPTION 'PAY005_FORBIDDEN_RAW_OR_SECRET_COLUMNS_PRESENT_%',sensitive_column_count; END IF;
END;
$$;

BEGIN;
INSERT INTO revenuecat_webhook_events(
 event_row_id,app_id,event_id,event_type,event_timestamp_ms,api_version,app_user_id,product_id,store,environment,
 transaction_id,original_transaction_id,event_data_json,payload_sha256,state,received_at,processed_at,outcome_code
) VALUES(
 'rcevt_1','luckread-android','evt_123','INITIAL_PURCHASE',1793300000000,'1.0','user_1',
 'creator.gold:monthly-v1','PLAY_STORE','SANDBOX','GPA.1234-5678','GPA.1234-5678',
 '{"product_id":"creator.gold:monthly-v1"}',repeat('a',64),'RECEIVED',TIMESTAMPTZ '2026-11-03T00:00:00Z',NULL,NULL
);

DO $$ BEGIN
 BEGIN
  INSERT INTO revenuecat_webhook_events(event_row_id,app_id,event_id,event_type,event_timestamp_ms,api_version,event_data_json,payload_sha256,state,received_at)
  VALUES('rcevt_duplicate','luckread-android','evt_123','INITIAL_PURCHASE',1793300000000,'1.0','{}',repeat('a',64),'RECEIVED',TIMESTAMPTZ '2026-11-03T00:00:01Z');
  RAISE EXCEPTION 'PAY005_DUPLICATE_FIRST_RECEIPT_NOT_REJECTED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO revenuecat_webhook_event_conflicts(conflict_id,app_id,event_id,existing_payload_sha256,incoming_payload_sha256,occurrence_count,first_seen_at,last_seen_at)
  VALUES('rcconf_bad_ref','other-app','unknown',repeat('a',64),repeat('b',64),1,TIMESTAMPTZ '2026-11-03T00:00:01Z',TIMESTAMPTZ '2026-11-03T00:00:01Z');
  RAISE EXCEPTION 'PAY005_CONFLICT_WITHOUT_FIRST_RECEIPT_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO revenuecat_webhook_event_conflicts(conflict_id,app_id,event_id,existing_payload_sha256,incoming_payload_sha256,occurrence_count,first_seen_at,last_seen_at)
  VALUES('rcconf_same_hash','luckread-android','evt_123',repeat('a',64),repeat('a',64),1,TIMESTAMPTZ '2026-11-03T00:00:01Z',TIMESTAMPTZ '2026-11-03T00:00:01Z');
  RAISE EXCEPTION 'PAY005_IDENTICAL_PAYLOAD_HASH_CONFLICT_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO revenuecat_webhook_event_conflicts(conflict_id,app_id,event_id,existing_payload_sha256,incoming_payload_sha256,occurrence_count,first_seen_at,last_seen_at)
  VALUES('rcconf_bad_hash','luckread-android','evt_123',repeat('a',64),repeat('g',64),1,TIMESTAMPTZ '2026-11-03T00:00:01Z',TIMESTAMPTZ '2026-11-03T00:00:01Z');
  RAISE EXCEPTION 'PAY005_MALFORMED_HASH_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

INSERT INTO revenuecat_webhook_event_conflicts(
 conflict_id,app_id,event_id,existing_payload_sha256,incoming_payload_sha256,occurrence_count,first_seen_at,last_seen_at
) VALUES(
 'rcconf_1','luckread-android','evt_123',repeat('a',64),repeat('b',64),1,
 TIMESTAMPTZ '2026-11-03T00:00:01Z',TIMESTAMPTZ '2026-11-03T00:00:01Z'
);
UPDATE revenuecat_webhook_event_conflicts SET occurrence_count=occurrence_count+1,
 last_seen_at=TIMESTAMPTZ '2026-11-03T00:00:02Z'
WHERE app_id='luckread-android' AND event_id='evt_123' AND incoming_payload_sha256=repeat('b',64);

DO $$ BEGIN
 BEGIN
  UPDATE revenuecat_webhook_event_conflicts SET occurrence_count=occurrence_count+2,
   last_seen_at=TIMESTAMPTZ '2026-11-03T00:00:03Z' WHERE conflict_id='rcconf_1';
  RAISE EXCEPTION 'PAY005_OCCURRENCE_COUNT_SKIP_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE revenuecat_webhook_event_conflicts SET occurrence_count=occurrence_count+1,
   last_seen_at=TIMESTAMPTZ '2026-11-03T00:00:01Z' WHERE conflict_id='rcconf_1';
  RAISE EXCEPTION 'PAY005_LAST_SEEN_BACKWARDS_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE revenuecat_webhook_event_conflicts SET incoming_payload_sha256=repeat('c',64),
   occurrence_count=occurrence_count+1,last_seen_at=TIMESTAMPTZ '2026-11-03T00:00:03Z'
  WHERE conflict_id='rcconf_1';
  RAISE EXCEPTION 'PAY005_CONFLICT_IDENTITY_MUTATION_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO revenuecat_webhook_event_conflicts(conflict_id,app_id,event_id,existing_payload_sha256,incoming_payload_sha256,occurrence_count,first_seen_at,last_seen_at)
  VALUES('rcconf_duplicate','luckread-android','evt_123',repeat('a',64),repeat('b',64),1,TIMESTAMPTZ '2026-11-03T00:00:03Z',TIMESTAMPTZ '2026-11-03T00:00:03Z');
  RAISE EXCEPTION 'PAY005_DUPLICATE_PAYLOAD_CONFLICT_NOT_REJECTED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  UPDATE revenuecat_webhook_events SET event_data_json='{}' WHERE event_row_id='rcevt_1';
  RAISE EXCEPTION 'PAY005_FIRST_RECEIPT_PAYLOAD_MUTATION_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

UPDATE revenuecat_webhook_events SET state='APPLIED',
 processed_at=TIMESTAMPTZ '2026-11-03T00:00:03Z',outcome_code='APPLIED'
WHERE event_row_id='rcevt_1';

DO $$ BEGIN
 BEGIN UPDATE revenuecat_webhook_events SET outcome_code='REWRITTEN' WHERE event_row_id='rcevt_1'; RAISE EXCEPTION 'PAY005_TERMINAL_RECEIPT_UPDATE_NOT_REJECTED'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM revenuecat_webhook_events WHERE event_row_id='rcevt_1'; RAISE EXCEPTION 'PAY005_RECEIPT_RETENTION_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM revenuecat_webhook_event_conflicts WHERE conflict_id='rcconf_1'; RAISE EXCEPTION 'PAY005_CONFLICT_RETENTION_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

ROLLBACK;

DO $$
DECLARE event_rows BIGINT; conflict_rows BIGINT; scheduler_rows BIGINT;
BEGIN
 SELECT count(*) INTO event_rows FROM revenuecat_webhook_events;
 SELECT count(*) INTO conflict_rows FROM revenuecat_webhook_event_conflicts;
 SELECT count(*) INTO scheduler_rows FROM subscription_renewal_scheduler_state
 WHERE state_id='subscription-renewals' AND cursor_period_end IS NULL AND cursor_subscription_id IS NULL AND version=1;
 IF event_rows<>0 OR conflict_rows<>0 THEN RAISE EXCEPTION 'PAY005_ROLLBACK_LEFT_EVENT_ROWS_%_CONFLICT_ROWS_%',event_rows,conflict_rows; END IF;
 IF scheduler_rows<>1 OR (SELECT count(*) FROM subscription_renewal_scheduler_state)<>1 THEN
  RAISE EXCEPTION 'PAY005_PREDECESSOR_SCHEDULER_CONTROL_SEED_NOT_RESTORED';
 END IF;
END $$;

SELECT jsonb_build_object(
 'database',current_database(),'postgresMajor',18,
 'newSliceTables',2,'newSliceExplicitIndexes',3,'newSliceTriggers',7,'newSliceTriggerFunctions',1,
 'cumulativeTables',12,'cumulativeExplicitIndexes',25,'cumulativeTriggers',56,'cumulativeTriggerFunctions',4,
 'foreignKeys',0,'revenuecatEventRowsAfterRollback',0,'revenuecatConflictRowsAfterRollback',0,
 'schedulerControlRows',1,'rawBodyColumns',0,'subscriberAttributesColumns',0,
 'remoteNeonTouched',false,'cloudflareD1Touched',false,'businessDataImported',false,'productionCutoverAuthorized',false
) AS d1_04_w07_revenuecat_webhook_postflight;
