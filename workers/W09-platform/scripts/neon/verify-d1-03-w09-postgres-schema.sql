\set ON_ERROR_STOP on

DO $$
DECLARE
  actual_tables TEXT[];
  expected_tables TEXT[] := ARRAY['audit_events', 'notification_push_endpoints'];
  actual_audit_columns TEXT[];
  expected_audit_columns TEXT[] := ARRAY[
    'event_id','request_id','trace_id','actor_json','action','target_type',
    'target_id','before_json','after_json','reason','ip','user_agent','occurred_at'
  ];
  actual_endpoint_columns TEXT[];
  expected_endpoint_columns TEXT[] := ARRAY[
    'endpoint_id','installation_id','owner_user_id','provider','platform',
    'push_token','permission_status','app_version','created_at','updated_at','last_seen_at'
  ];
  explicit_index_count INTEGER;
  trigger_names TEXT[];
  foreign_key_count INTEGER;
BEGIN
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'Expected PostgreSQL 18, got %', current_setting('server_version');
  END IF;
  IF current_database() <> 'luckread_d1_03_w09_rehearsal' THEN
    RAISE EXCEPTION 'Unexpected rehearsal database: %', current_database();
  END IF;

  SELECT array_agg(table_name ORDER BY table_name)
    INTO actual_tables
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  IF actual_tables IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'Unexpected W09 table set: %', actual_tables;
  END IF;

  SELECT array_agg(column_name ORDER BY ordinal_position)
    INTO actual_audit_columns
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'audit_events';
  IF actual_audit_columns IS DISTINCT FROM expected_audit_columns THEN
    RAISE EXCEPTION 'AuditEvent column drift: %', actual_audit_columns;
  END IF;

  SELECT array_agg(column_name ORDER BY ordinal_position)
    INTO actual_endpoint_columns
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'notification_push_endpoints';
  IF actual_endpoint_columns IS DISTINCT FROM expected_endpoint_columns THEN
    RAISE EXCEPTION 'NotificationPushEndpoint column drift: %', actual_endpoint_columns;
  END IF;

  SELECT count(*) INTO explicit_index_count
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'idx_audit_events_action_occurred_at',
       'idx_audit_events_target_occurred_at',
       'uq_notification_push_endpoints_provider_token',
       'ix_notification_push_endpoints_owner_status'
     );
  IF explicit_index_count <> 4 THEN
    RAISE EXCEPTION 'Expected four explicit W09 indexes, got %', explicit_index_count;
  END IF;

  SELECT array_agg(t.tgname ORDER BY t.tgname)
    INTO trigger_names
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF trigger_names IS DISTINCT FROM ARRAY[
    'trg_neon_w09_audit_events_immutable_truncate',
    'trg_neon_w09_audit_events_immutable_update_delete'
  ] THEN
    RAISE EXCEPTION 'Unexpected W09 trigger set: %', trigger_names;
  END IF;

  SELECT count(*) INTO foreign_key_count
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND c.contype = 'f';
  IF foreign_key_count <> 0 THEN
    RAISE EXCEPTION 'D1-03 W09 slice must not create cross-domain foreign keys';
  END IF;
END;
$$;

-- Exercise constraints and immutable AuditEvent behavior in a rollback-only transaction.
BEGIN;
INSERT INTO audit_events (
  event_id, actor_json, action, target_type, target_id,
  before_json, after_json, occurred_at
) VALUES (
  'w09-rehearsal-audit-1',
  '{"actorType":"SYSTEM"}'::jsonb,
  'governance.rehearsal',
  'SchemaRehearsal',
  'w09-rehearsal',
  '{}'::jsonb,
  '{"ok":true}'::jsonb,
  now()
);

DO $$
BEGIN
  UPDATE audit_events SET reason = 'must fail' WHERE event_id = 'w09-rehearsal-audit-1';
  RAISE EXCEPTION 'AuditEvent UPDATE was not rejected';
EXCEPTION WHEN SQLSTATE '55000' THEN
  NULL;
END;
$$;

DO $$
BEGIN
  DELETE FROM audit_events WHERE event_id = 'w09-rehearsal-audit-1';
  RAISE EXCEPTION 'AuditEvent DELETE was not rejected';
EXCEPTION WHEN SQLSTATE '55000' THEN
  NULL;
END;
$$;

DO $$
BEGIN
  TRUNCATE TABLE audit_events;
  RAISE EXCEPTION 'AuditEvent TRUNCATE was not rejected';
EXCEPTION WHEN SQLSTATE '55000' THEN
  NULL;
END;
$$;

INSERT INTO notification_push_endpoints (
  endpoint_id, installation_id, owner_user_id, provider, platform,
  push_token, permission_status, created_at, updated_at, last_seen_at
) VALUES (
  'w09-endpoint-1', 'w09-installation-1', 'opaque-user-1', 'expo', 'android',
  'ExponentPushToken[w09_rehearsal_token_1234567890]', 'granted', now(), now(), now()
);

DO $$
BEGIN
  INSERT INTO notification_push_endpoints (
    endpoint_id, installation_id, owner_user_id, provider, platform,
    push_token, permission_status, created_at, updated_at, last_seen_at
  ) VALUES (
    'w09-endpoint-duplicate', 'w09-installation-2', 'opaque-user-2', 'expo', 'ios',
    'ExponentPushToken[w09_rehearsal_token_1234567890]', 'granted', now(), now(), now()
  );
  RAISE EXCEPTION 'Duplicate Expo token was accepted';
EXCEPTION WHEN unique_violation THEN
  NULL;
END;
$$;

DO $$
BEGIN
  INSERT INTO notification_push_endpoints (
    endpoint_id, installation_id, owner_user_id, provider, platform,
    push_token, permission_status, created_at, updated_at, last_seen_at
  ) VALUES (
    'w09-endpoint-denied-with-token', 'w09-installation-3', 'opaque-user-3', 'expo', 'ios',
    'ExponentPushToken[w09_invalid_token_1234567890]', 'denied', now(), now(), now()
  );
  RAISE EXCEPTION 'Denied endpoint retained a push token';
EXCEPTION WHEN check_violation THEN
  NULL;
END;
$$;

ROLLBACK;

DO $$
DECLARE
  audit_rows BIGINT;
  endpoint_rows BIGINT;
BEGIN
  SELECT count(*) INTO audit_rows FROM audit_events;
  SELECT count(*) INTO endpoint_rows FROM notification_push_endpoints;
  IF audit_rows <> 0 OR endpoint_rows <> 0 THEN
    RAISE EXCEPTION 'Rollback-only rehearsal left rows: audit_events=%, notification_push_endpoints=%',
      audit_rows, endpoint_rows;
  END IF;
END;
$$;

SELECT json_build_object(
  'database', current_database(),
  'postgresMajor', current_setting('server_version_num')::INTEGER / 10000,
  'tables', 2,
  'explicitIndexes', 4,
  'triggers', 2,
  'foreignKeys', 0,
  'auditEventRowsAfterRollback', (SELECT count(*) FROM audit_events),
  'pushEndpointRowsAfterRollback', (SELECT count(*) FROM notification_push_endpoints),
  'businessDataImported', false,
  'remoteNeonTouched', false,
  'cloudflareD1Touched', false
)::text AS neon_d1_03_w09_postflight;
