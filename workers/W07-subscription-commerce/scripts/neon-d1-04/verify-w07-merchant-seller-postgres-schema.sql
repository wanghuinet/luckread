\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  table_count INTEGER;
  index_count INTEGER;
  trigger_count INTEGER;
  trigger_function_count INTEGER;
  foreign_key_count INTEGER;
BEGIN
  SELECT count(*) INTO table_count FROM pg_catalog.pg_tables WHERE schemaname='public';
  SELECT count(*) INTO index_count FROM pg_catalog.pg_indexes WHERE schemaname='public'
    AND indexname NOT IN (
      'billing_documents_pkey','order_create_idempotency_customer_id_operation_key_idempote_key',
      'order_create_idempotency_pkey','order_lines_pkey','orders_pkey','payment_mandates_pkey',
      'payment_mandates_provider_merchant_id_source_event_id_key','payment_mandates_provider_merchant_id_source_payment_id_key',
      'payment_method_revocation_requests_pkey','payment_provider_event_confli_provider_merchant_id_event_id_key',
      'payment_provider_event_conflicts_pkey','payment_provider_events_pkey','payment_provider_events_provider_merchant_id_event_id_key',
      'payments_customer_id_idempotency_key_key','payments_pkey','refunds_pkey',
      'revenuecat_webhook_event_conflicts_pkey','revenuecat_webhook_events_pkey','saved_payment_methods_pkey',
      'saved_payment_methods_provider_merchant_id_payment_method_i_key','subscription_renewal_cycles_pkey',
      'subscription_renewal_scheduler_state_pkey','uq_billing_documents_number','uq_billing_documents_type_order',
      'uq_payment_method_revocation_saved_method','uq_refunds_customer_idempotency','uq_refunds_provider_merchant_refund',
      'uq_revenuecat_webhook_event_conflicts_payload','uq_revenuecat_webhook_events_app_event'
    );
  SELECT count(*) INTO trigger_count FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal;
  SELECT count(*) INTO trigger_function_count FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'w07_d104_%';
  SELECT count(*) INTO foreign_key_count FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND c.contype='f';
  IF table_count<>20 OR index_count<>39 OR trigger_count<>97 OR trigger_function_count<>7 OR foreign_key_count<>0 THEN
    RAISE EXCEPTION 'D1-04 cumulative catalog mismatch: tables %, explicit indexes %, triggers %, functions %, foreign keys %',
      table_count,index_count,trigger_count,trigger_function_count,foreign_key_count;
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN (
    'ix_merchant_profiles_status_created','ix_merchant_stores_merchant_status_created',
    'ux_merchant_qualifications_jurisdiction','ix_merchant_qualifications_status_expiry',
    'ux_merchant_staff_active_user','ux_merchant_staff_active_owner',
    'ux_merchant_scopes_active_resource','ix_merchant_scopes_staff_status'
  ))<>8 THEN RAISE EXCEPTION 'Merchant/Seller explicit index inventory mismatch'; END IF;
END $$;

INSERT INTO merchant_profiles
(merchant_id,merchant_type,status,display_name,identity_ref,version,created_at,updated_at)
VALUES ('mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA','BUSINESS','ACTIVE','Schema Test Merchant','identity-ref:test',1,now(),now());

INSERT INTO merchant_stores
(store_id,merchant_id,name,status,version,created_at,updated_at)
VALUES ('str_BBBBBBBBBBBBBBBBBBBBBBBBBB','mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA','Primary Store','OPEN',1,now(),now());

UPDATE merchant_profiles SET primary_store_id='str_BBBBBBBBBBBBBBBBBBBBBBBBBB',version=2,updated_at=now()+interval '1 second'
WHERE merchant_id='mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA';

INSERT INTO merchant_qualifications
(qualification_id,merchant_id,capability,jurisdiction_country,status,evidence_ref,version,created_at,updated_at)
VALUES ('mql_CCCCCCCCCCCCCCCCCCCCCCCCCC','mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA','SUBSCRIPTION','US','APPROVED','evidence-ref:test',1,now(),now());

INSERT INTO merchant_staff
(staff_id,merchant_id,user_id,role,status,version,created_at,updated_at)
VALUES ('mst_DDDDDDDDDDDDDDDDDDDDDDDDDD','mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA','w02-user-1','OWNER','ACTIVE',1,now(),now());

INSERT INTO merchant_scopes
(scope_id,merchant_id,staff_id,scope_type,resource_id,access_level,status,version,created_at,updated_at)
VALUES ('msc_EEEEEEEEEEEEEEEEEEEEEEEEEE','mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA','mst_DDDDDDDDDDDDDDDDDDDDDDDDDD',
        'STORE','str_BBBBBBBBBBBBBBBBBBBBBBBBBB','MANAGE','ACTIVE',1,now(),now());

DO $$
BEGIN
  BEGIN
    UPDATE merchant_profiles SET primary_store_id='str_ZZZZZZZZZZZZZZZZZZZZZZZZZZ',version=3,updated_at=now()+interval '2 seconds'
      WHERE merchant_id='mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'expected primary-store ownership guard';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE merchant_stores SET merchant_id='mrc_ZZZZZZZZZZZZZZZZZZZZZZZZZZ',version=2,updated_at=now()+interval '2 seconds'
      WHERE store_id='str_BBBBBBBBBBBBBBBBBBBBBBBBBB';
    RAISE EXCEPTION 'expected immutable store ownership';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE merchant_profiles SET version=4,updated_at=now()+interval '3 seconds'
      WHERE merchant_id='mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'expected exact version CAS guard';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE merchant_profiles SET status='CLOSED',version=3,updated_at=now()+interval '2 seconds'
      WHERE merchant_id='mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA';
    UPDATE merchant_profiles SET status='ACTIVE',version=4,updated_at=now()+interval '3 seconds'
      WHERE merchant_id='mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'expected terminal CLOSED merchant state';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO merchant_scopes
    (scope_id,merchant_id,staff_id,scope_type,resource_id,access_level,status,version,created_at,updated_at)
    VALUES ('msc_FFFFFFFFFFFFFFFFFFFFFFFFFF','mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA','mst_DDDDDDDDDDDDDDDDDDDDDDDDDD',
      'SETTLEMENT_VIEW','merchant:mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA','WRITE','ACTIVE',1,now(),now());
    RAISE EXCEPTION 'expected settlement scope read-only check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM merchant_profiles WHERE merchant_id='mrc_AAAAAAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'expected retained merchant record';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;

DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT (SELECT count(*) FROM merchant_profiles)
       + (SELECT count(*) FROM merchant_stores)
       + (SELECT count(*) FROM merchant_qualifications)
       + (SELECT count(*) FROM merchant_staff)
       + (SELECT count(*) FROM merchant_scopes)
    INTO remaining;
  IF remaining<>0 THEN RAISE EXCEPTION 'Merchant/Seller schema rehearsal left % fixture rows',remaining; END IF;
END $$;
