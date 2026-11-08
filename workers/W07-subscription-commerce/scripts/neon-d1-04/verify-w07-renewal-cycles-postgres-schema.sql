-- PAY-004 D1-04 W07 renewal-cycle PostgreSQL 18 local postflight.
-- Disposable local database only. No connection to Neon or Cloudflare D1.

DO $$
DECLARE table_count BIGINT; index_count BIGINT; trigger_count BIGINT; function_count BIGINT; fk_count BIGINT; seed_count BIGINT;
BEGIN
 SELECT count(*) INTO table_count FROM pg_tables WHERE schemaname=current_schema()
 AND tablename=ANY(ARRAY['orders','order_lines','order_create_idempotency','payments','payment_provider_events','payment_provider_event_conflicts','saved_payment_methods','payment_mandates','subscription_renewal_cycles','subscription_renewal_scheduler_state']);
 IF table_count<>10 THEN RAISE EXCEPTION 'PAY004_EXPECTED_10_TABLES_GOT_%',table_count; END IF;
 SELECT count(*) INTO index_count FROM pg_indexes WHERE schemaname=current_schema() AND indexname=ANY(ARRAY['ix_orders_customer_created_order','ix_orders_status_created_order','ix_order_lines_order_id','ix_order_lines_item_ref_version','ix_order_create_idempotency_customer_created','ix_order_create_idempotency_expiration','ix_payments_customer_created_payment','ix_payments_order_created_payment','ix_payments_status_updated_payment','ux_payments_single_live_or_successful_per_order','ix_payment_provider_events_state_received','ix_payment_provider_events_payment_received','ix_payment_provider_event_conflicts_state_last_seen','ix_payment_provider_event_conflicts_identity','ix_saved_payment_methods_customer_created','ux_payment_mandates_provider_mandate_id','ix_payment_mandates_customer_status_created','ix_payment_mandates_method_status','ux_subscription_renewal_cycles_subscription_cycle','ux_subscription_renewal_cycles_payment','ix_subscription_renewal_cycles_state_updated','ix_subscription_renewal_cycles_subscriber_cycle']);
 IF index_count<>22 THEN RAISE EXCEPTION 'PAY004_EXPECTED_22_INDEXES_GOT_%',index_count; END IF;
 SELECT count(*) INTO trigger_count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND NOT t.tgisinternal AND t.tgname=ANY(ARRAY['orders_commercial_snapshot_immutable','orders_version_must_advance','orders_status_transition_guard','orders_retained','order_lines_require_order','order_lines_immutable_update','order_lines_retained','orders_require_matching_completed_idempotency','order_create_idempotency_identity_immutable','order_create_idempotency_terminal_immutable','payments_require_payable_order','payments_snapshot_immutable','payments_version_must_advance','payments_terminal_status_guard','payments_provider_timestamp_monotonic','payments_retained','payment_provider_events_identity_immutable','payment_provider_events_terminal_immutable','payment_provider_events_retained','payment_provider_event_conflicts_reference_first_receipt','payment_provider_event_conflicts_identity_immutable','payment_provider_event_conflicts_version_guard','payment_provider_event_conflicts_resolved_immutable','payment_provider_event_conflicts_retained','saved_payment_methods_require_succeeded_payment','saved_payment_methods_customer_binding_guard','saved_payment_methods_identity_immutable','saved_payment_methods_retained','payment_mandates_require_saved_method','payment_mandates_start_pending','payment_mandates_identity_immutable','payment_mandates_version_guard','payment_mandates_transition_guard','payment_mandates_provider_id_immutable','payment_mandates_provider_timestamp_monotonic','payment_mandates_retained','subscription_renewal_cycles_initial_state_guard','subscription_renewal_cycles_identity_immutable','subscription_renewal_cycles_resolved_snapshot_immutable','subscription_renewal_cycles_version_guard','subscription_renewal_cycles_state_transition_guard','subscription_renewal_cycles_sync_state_transition_guard','subscription_renewal_cycles_order_binding_guard','subscription_renewal_cycles_payment_binding_guard','subscription_renewal_cycles_requires_active_mandate','subscription_renewal_cycles_retained','subscription_renewal_scheduler_state_identity_immutable','subscription_renewal_scheduler_state_version_guard','subscription_renewal_scheduler_state_retained']);
 IF trigger_count<>49 THEN RAISE EXCEPTION 'PAY004_EXPECTED_49_TRIGGERS_GOT_%',trigger_count; END IF;
 SELECT count(*) INTO function_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.proname=ANY(ARRAY['w07_d104_order_payment_source_guard','w07_d104_saved_mandate_source_guard','w07_d104_renewal_cycles_source_guard']);
 IF function_count<>3 THEN RAISE EXCEPTION 'PAY004_EXPECTED_3_TRIGGER_FUNCTIONS_GOT_%',function_count; END IF;
 SELECT count(*) INTO fk_count FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND con.contype='f' AND c.relname=ANY(ARRAY['orders','order_lines','order_create_idempotency','payments','payment_provider_events','payment_provider_event_conflicts','saved_payment_methods','payment_mandates','subscription_renewal_cycles','subscription_renewal_scheduler_state']);
 IF fk_count<>0 THEN RAISE EXCEPTION 'PAY004_EXPECTED_ZERO_FKS_GOT_%',fk_count; END IF;
 SELECT count(*) INTO seed_count FROM subscription_renewal_scheduler_state
 WHERE state_id='subscription-renewals' AND cursor_period_end IS NULL AND cursor_subscription_id IS NULL AND version=1 AND updated_at=TIMESTAMPTZ '1970-01-01T00:00:00.000Z';
 IF seed_count<>1 OR (SELECT count(*) FROM subscription_renewal_scheduler_state)<>1 THEN RAISE EXCEPTION 'PAY004_EXPECTED_SINGLE_SCHEDULER_CONTROL_SEED'; END IF;
END;
$$;

BEGIN;
INSERT INTO order_create_idempotency(id,customer_id,operation_key,idempotency_key,request_hash,state,response_status,response_json,created_at,expires_at)
VALUES('idem-renewal-1','customer-renewal-1','POST /v1/commerce/orders','order-renewal-1',repeat('a',64),'COMPLETED',201,'{"orderId":"order-renewal-1"}',TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-11-02T00:00:00Z');
INSERT INTO orders(order_id,customer_id,status,version,currency,subtotal_minor,discount_minor,tax_minor,total_minor,created_at,updated_at)
VALUES('order-renewal-1','customer-renewal-1','CREATED',1,'USD',1000,0,0,1000,TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z');
INSERT INTO order_lines(order_line_id,order_id,item_type,item_ref,item_version,quantity,unit_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,item_snapshot_json,created_at)
VALUES('line-renewal-1','order-renewal-1','MEMBERSHIP_PLAN','plan-basic','1',1,1000,1000,0,0,1000,'{"subscriptionRenewal":{"subscriptionId":"sub-renewal-1","cycleStart":"2026-11-01T00:00:00.000Z","cycleEnd":"2026-12-01T00:00:00.000Z"}}',TIMESTAMPTZ '2026-11-01T00:00:00Z');
INSERT INTO payments(payment_id,order_id,customer_id,provider,merchant_id,amount_minor,currency,status,version,idempotency_key,request_hash,provider_updated_at,failure_code,created_at,updated_at)
VALUES('pay_aaaaaaaaaaaaaaaaaaaaaaaaaa','order-renewal-1','customer-renewal-1','hyperswitch','merchant-renewal-1',1000,'USD','INITIATING',1,'payment-renewal-1',repeat('b',64),NULL,NULL,TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z');
UPDATE payments SET status='succeeded',version=2,provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z',updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z' WHERE payment_id='pay_aaaaaaaaaaaaaaaaaaaaaaaaaa';
INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code)
VALUES('event-row-renewal-1','hyperswitch','merchant-renewal-1','event-renewal-1','payment_succeeded','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('c',64),'RECEIVED',TIMESTAMPTZ '2026-11-01T00:00:02Z',NULL,NULL);
INSERT INTO saved_payment_methods(saved_payment_method_id,provider,merchant_id,customer_id,payment_method_id,source_payment_id,source_event_id,created_at)
VALUES('spm_ssssssssssssssssssssssssss','hyperswitch','merchant-renewal-1','customer-renewal-1','pm_hyperswitch_renewal_1','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa','event-renewal-1',TIMESTAMPTZ '2026-11-01T00:00:03Z');
INSERT INTO payment_mandates(mandate_record_id,provider,merchant_id,customer_id,payment_method_id,source_payment_id,source_event_id,consent_accepted_at,consent_acceptance_type,consent_scope,consent_terms_version,provider_mandate_id,status,version,provider_updated_at,created_at,updated_at)
VALUES('mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm','hyperswitch','merchant-renewal-1','customer-renewal-1','pm_hyperswitch_renewal_1','pay_aaaaaaaaaaaaaaaaaaaaaaaaaa','event-renewal-1',TIMESTAMPTZ '2026-11-01T00:00:03Z','online','OFF_SESSION_RECURRING','luckread-recurring-consent-v1',NULL,'PENDING_PROVIDER_CONFIRMATION',1,NULL,TIMESTAMPTZ '2026-11-01T00:00:03Z',TIMESTAMPTZ '2026-11-01T00:00:03Z');

DO $$ BEGIN
 BEGIN
  INSERT INTO subscription_renewal_cycles(cycle_id,provider,merchant_id,subscription_id,subscriber_id,plan_id,plan_version,cycle_start,cycle_end,billing_interval,currency,offer_snapshot_json,amount_minor,pricing_snapshot_json,state,created_at,updated_at)
  VALUES('rcy_bbbbbbbbbbbbbbbbbbbbbbbbbb','hyperswitch','merchant-renewal-1','sub-invalid-insert','customer-renewal-1','plan-basic',1,TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-12-01T00:00:00Z','MONTHLY','USD','{"subscriptionId":"sub-invalid-insert"}',1000,'{"currency":"USD"}','PREPARED',TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z');
  RAISE EXCEPTION 'PAY004_INITIAL_STATE_GUARD_NOT_ENFORCED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

INSERT INTO subscription_renewal_cycles(cycle_id,provider,merchant_id,subscription_id,subscriber_id,plan_id,plan_version,cycle_start,cycle_end,billing_interval,currency,offer_snapshot_json,amount_minor,pricing_snapshot_json,payment_method_id,mandate_record_id,order_id,payment_id,state,attempt_number,provider_response_status,outcome_code,subscription_sync_state,subscription_sync_updated_at,subscription_sync_error_code,lease_token,lease_expires_at,version,created_at,updated_at)
VALUES('rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa','hyperswitch','merchant-renewal-1','sub-renewal-1','customer-renewal-1','plan-basic',1,TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-12-01T00:00:00Z','MONTHLY','USD','{"subscriptionId":"sub-renewal-1","subscriberId":"customer-renewal-1","planId":"plan-basic","planVersion":1,"billingInterval":"MONTHLY","priceMinor":1000,"currency":"USD"}',NULL,NULL,NULL,NULL,NULL,NULL,'AWAITING_PRICING',0,NULL,NULL,'PENDING',NULL,NULL,NULL,NULL,1,TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z');

DO $$ BEGIN
 BEGIN
  INSERT INTO subscription_renewal_cycles(cycle_id,provider,merchant_id,subscription_id,subscriber_id,plan_id,plan_version,cycle_start,cycle_end,billing_interval,currency,offer_snapshot_json,state,created_at,updated_at)
  VALUES('rcy_cccccccccccccccccccccccccc','hyperswitch','merchant-renewal-1','sub-renewal-1','customer-renewal-1','plan-basic',1,TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-12-01T00:00:00Z','MONTHLY','USD','{"subscriptionId":"sub-renewal-1"}','AWAITING_PRICING',TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z');
  RAISE EXCEPTION 'PAY004_DUPLICATE_SUBSCRIPTION_PERIOD_NOT_REJECTED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

UPDATE subscription_renewal_cycles SET amount_minor=1000,pricing_snapshot_json='{"currency":"USD","taxMode":"demo","items":[{"amountMinor":1000}]}',payment_method_id='pm_hyperswitch_renewal_1',mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm',state='PREPARED',version=2,updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa';

DO $$ BEGIN
 BEGIN UPDATE subscription_renewal_cycles SET amount_minor=900,version=3,updated_at=TIMESTAMPTZ '2026-11-01T00:00:02Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_RESOLVED_AMOUNT_IMMUTABILITY_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE subscription_renewal_cycles SET plan_id='plan-rewritten',version=3,updated_at=TIMESTAMPTZ '2026-11-01T00:00:02Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_IDENTITY_IMMUTABILITY_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE subscription_renewal_cycles SET subscription_sync_state='APPLIED',subscription_sync_updated_at=TIMESTAMPTZ '2026-11-01T00:00:02Z',version=3,updated_at=TIMESTAMPTZ '2026-11-01T00:00:02Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_EARLY_SYNC_NOT_BLOCKED'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE subscription_renewal_cycles SET order_id='missing-order',version=3,updated_at=TIMESTAMPTZ '2026-11-01T00:00:02Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_ORDER_BINDING_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE subscription_renewal_cycles SET order_id='order-renewal-1',version=3,updated_at=TIMESTAMPTZ '2026-11-01T00:00:02Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa';
DO $$ BEGIN
 BEGIN UPDATE subscription_renewal_cycles SET payment_id='pay_bbbbbbbbbbbbbbbbbbbbbbbbbb',version=4,updated_at=TIMESTAMPTZ '2026-11-01T00:00:03Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_PAYMENT_BINDING_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE subscription_renewal_cycles SET payment_id='pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',version=4,updated_at=TIMESTAMPTZ '2026-11-01T00:00:03Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa';
DO $$ BEGIN
 BEGIN UPDATE subscription_renewal_cycles SET state='PAYMENT_READY',version=5,updated_at=TIMESTAMPTZ '2026-11-01T00:00:04Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_PENDING_MANDATE_ALLOWED_PAYMENT_READY'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE payment_mandates SET provider_mandate_id='provider-mandate-renewal-1',version=2,updated_at=TIMESTAMPTZ '2026-11-01T00:00:04Z' WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';
UPDATE payment_mandates SET status='ACTIVE',version=3,provider_updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z',updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z' WHERE mandate_record_id='mnd_mmmmmmmmmmmmmmmmmmmmmmmmmm';
UPDATE subscription_renewal_cycles SET state='PAYMENT_READY',version=5,updated_at=TIMESTAMPTZ '2026-11-01T00:00:04Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa';
DO $$ BEGIN
 BEGIN UPDATE subscription_renewal_cycles SET state='SUBMITTING',version=6,updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_SUBMITTING_WITHOUT_LEASE_NOT_BLOCKED'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE subscription_renewal_cycles SET state='SUBMITTING',lease_token='lease-renewal-1',lease_expires_at=TIMESTAMPTZ '2026-11-01T00:02:05Z',version=6,updated_at=TIMESTAMPTZ '2026-11-01T00:00:05Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa';
UPDATE subscription_renewal_cycles SET state='SUBMITTED',lease_token=NULL,lease_expires_at=NULL,provider_response_status='processing',version=7,updated_at=TIMESTAMPTZ '2026-11-01T00:00:06Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa';
DO $$ BEGIN
 BEGIN UPDATE subscription_renewal_cycles SET state='PREPARED',version=8,updated_at=TIMESTAMPTZ '2026-11-01T00:00:07Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_ILLEGAL_BACKWARD_TRANSITION_NOT_BLOCKED'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE subscription_renewal_cycles SET state='SUCCEEDED',provider_response_status='succeeded',outcome_code='PROVIDER_WEBHOOK_SUCCEEDED',version=8,updated_at=TIMESTAMPTZ '2026-11-01T00:00:07Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa';
UPDATE subscription_renewal_cycles SET subscription_sync_state='APPLIED',subscription_sync_updated_at=TIMESTAMPTZ '2026-11-01T00:00:08Z',version=9,updated_at=TIMESTAMPTZ '2026-11-01T00:00:08Z' WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa';

DO $$ BEGIN
 BEGIN UPDATE subscription_renewal_scheduler_state SET cursor_period_end=TIMESTAMPTZ '2026-12-01T00:00:00Z',cursor_subscription_id='sub-renewal-1',updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z' WHERE state_id='subscription-renewals'; RAISE EXCEPTION 'PAY004_SCHEDULER_CAS_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE subscription_renewal_scheduler_state SET state_id='rewritten',version=2,updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z' WHERE state_id='subscription-renewals'; RAISE EXCEPTION 'PAY004_SCHEDULER_IDENTITY_NOT_IMMUTABLE'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE subscription_renewal_scheduler_state SET cursor_period_end=TIMESTAMPTZ '2026-12-01T00:00:00Z',cursor_subscription_id='sub-renewal-1',version=2,updated_at=TIMESTAMPTZ '2026-11-01T00:00:01Z' WHERE state_id='subscription-renewals';
DO $$ BEGIN
 BEGIN DELETE FROM subscription_renewal_cycles WHERE cycle_id='rcy_aaaaaaaaaaaaaaaaaaaaaaaaaa'; RAISE EXCEPTION 'PAY004_CYCLE_RETENTION_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM subscription_renewal_scheduler_state WHERE state_id='subscription-renewals'; RAISE EXCEPTION 'PAY004_SCHEDULER_RETENTION_NOT_ENFORCED'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;

DO $$
DECLARE fixture_rows BIGINT; seed_count BIGINT;
BEGIN
 SELECT (SELECT count(*) FROM orders)+(SELECT count(*) FROM order_lines)+(SELECT count(*) FROM order_create_idempotency)+
 (SELECT count(*) FROM payments)+(SELECT count(*) FROM payment_provider_events)+(SELECT count(*) FROM payment_provider_event_conflicts)+
 (SELECT count(*) FROM saved_payment_methods)+(SELECT count(*) FROM payment_mandates)+(SELECT count(*) FROM subscription_renewal_cycles)
 INTO fixture_rows;
 SELECT count(*) INTO seed_count FROM subscription_renewal_scheduler_state
 WHERE state_id='subscription-renewals' AND cursor_period_end IS NULL AND cursor_subscription_id IS NULL AND version=1;
 IF fixture_rows<>0 THEN RAISE EXCEPTION 'PAY004_ROLLBACK_LEFT_%_BUSINESS_FIXTURE_ROWS',fixture_rows; END IF;
 IF seed_count<>1 OR (SELECT count(*) FROM subscription_renewal_scheduler_state)<>1 THEN RAISE EXCEPTION 'PAY004_SCHEDULER_SEED_NOT_RESTORED'; END IF;
END $$;

SELECT jsonb_build_object('database',current_database(),'postgresMajor',18,'newSliceTables',2,'newSliceExplicitIndexes',4,'newSliceTriggers',13,'newSliceTriggerFunctions',1,'cumulativeTables',10,'cumulativeExplicitIndexes',22,'cumulativeTriggers',49,'cumulativeTriggerFunctions',3,'foreignKeys',0,'schedulerControlRows',1,'businessFixtureRowsAfterRollback',0,'laterFinanceTablesIncluded',false,'remoteNeonTouched',false,'cloudflareD1Touched',false,'businessDataImported',false,'productionCutoverAuthorized',false) AS d1_04_w07_renewal_cycles_postflight;
