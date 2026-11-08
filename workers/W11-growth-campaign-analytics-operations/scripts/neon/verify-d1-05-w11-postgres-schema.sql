\set ON_ERROR_STOP on

DO $$
DECLARE
  table_count INTEGER;
  explicit_index_count INTEGER;
  foreign_key_count INTEGER;
  trigger_count INTEGER;
  identity_column_count INTEGER;
  actual_tables TEXT[];
BEGIN
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'EXPECTED_POSTGRESQL_18';
  END IF;

  SELECT array_agg(tablename ORDER BY tablename)
    INTO actual_tables
  FROM pg_catalog.pg_tables
  WHERE schemaname = current_schema()
    AND tablename NOT LIKE 'pg_%'
    AND tablename <> 'sql_features';

  IF actual_tables IS DISTINCT FROM ARRAY[
    'analytics_content_hourly',
    'analytics_creator_hourly',
    'analytics_event_dedupe',
    'analytics_projection_rebuild_state',
    'analytics_reconciliation_status',
    'analytics_rollup_watermark'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'UNEXPECTED_D1_05_TABLE_SET: %', actual_tables;
  END IF;
  table_count := cardinality(actual_tables);
  IF table_count <> 6 THEN
    RAISE EXCEPTION 'EXPECTED_6_ANALYTICS_TABLES_GOT_%', table_count;
  END IF;

  SELECT count(*) INTO explicit_index_count
  FROM pg_catalog.pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = ANY (ARRAY[
      'analytics_event_dedupe_ingested_at_idx',
      'analytics_event_dedupe_occurred_at_idx',
      'analytics_event_dedupe_hour_start_idx',
      'analytics_event_dedupe_pending_idx',
      'analytics_content_hourly_content_time_idx',
      'analytics_content_hourly_content_id_time_idx',
      'analytics_content_hourly_time_idx',
      'analytics_creator_hourly_creator_time_idx'
    ]);
  IF explicit_index_count <> 8 THEN
    RAISE EXCEPTION 'EXPECTED_8_EXPLICIT_INDEXES_GOT_%', explicit_index_count;
  END IF;

  SELECT count(*) INTO foreign_key_count
  FROM information_schema.table_constraints
  WHERE constraint_schema = current_schema()
    AND table_name LIKE 'analytics_%'
    AND constraint_type = 'FOREIGN KEY';
  IF foreign_key_count <> 0 THEN
    RAISE EXCEPTION 'EXPECTED_ZERO_CROSS_DOMAIN_FOREIGN_KEYS_GOT_%', foreign_key_count;
  END IF;

  SELECT count(*) INTO trigger_count
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname LIKE 'analytics_%'
    AND NOT t.tgisinternal;
  IF trigger_count <> 0 THEN
    RAISE EXCEPTION 'EXPECTED_ZERO_UNDECLARED_TRIGGERS_GOT_%', trigger_count;
  END IF;

  SELECT count(*) INTO identity_column_count
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name LIKE 'analytics_%'
    AND column_name = ANY (ARRAY['actor_id', 'visitor_id', 'session_id']);
  IF identity_column_count <> 0 THEN
    RAISE EXCEPTION 'DIRECT_ACTOR_VISITOR_OR_SESSION_IDENTIFIERS_MUST_NOT_BE_PERSISTED';
  END IF;

  IF to_regclass(format('%I.%I', current_schema(), 'campaigns')) IS NOT NULL
     OR to_regclass(format('%I.%I', current_schema(), 'growth_operations')) IS NOT NULL THEN
    RAISE EXCEPTION 'T22_CAMPAIGN_AND_GROWTH_OPERATION_SCHEMA_MUST_NOT_BE_INVENTED';
  END IF;
END;
$$;

BEGIN;

INSERT INTO analytics_event_dedupe (
  event_id, dedupe_key, schema_version, event_name, source_worker,
  occurred_at, received_at, hour_start, actor_type, content_id, content_type,
  creator_id, duration_ms, position, metric_version, projection_status
) VALUES (
  'fixture-w01-content-open', 'fixture-dedupe-w01-content-open', '1.0',
  'content_open', 'W01', '2026-11-08T12:12:34.000Z', '2026-11-08T12:12:35.000Z',
  '2026-11-08T12:00:00.000Z', 'visitor', 'fixture-content', 'article',
  NULL, NULL, NULL, '1.0', 'PENDING'
);

INSERT INTO analytics_event_dedupe (
  event_id, dedupe_key, schema_version, event_name, source_worker,
  occurred_at, received_at, hour_start, actor_type, content_id, content_type,
  creator_id, duration_ms, position, metric_version, projection_status
) VALUES (
  'fixture-w05-like', 'fixture-dedupe-w05-like', '1.0',
  'like_created', 'W05', '2026-11-08T12:13:34.000Z', '2026-11-08T12:13:35.000Z',
  '2026-11-08T12:00:00.000Z', 'user', 'fixture-content', 'article',
  NULL, NULL, NULL, '1.0', 'APPLIED'
);

INSERT INTO analytics_event_dedupe (
  event_id, dedupe_key, schema_version, event_name, source_worker,
  occurred_at, received_at, hour_start, actor_type, content_id, content_type,
  creator_id, duration_ms, position, metric_version, projection_status
) VALUES (
  'fixture-w05-follow', 'fixture-dedupe-w05-follow', '1.0',
  'follow_created', 'W05', '2026-11-08T12:14:34.000Z', '2026-11-08T12:14:35.000Z',
  '2026-11-08T12:00:00.000Z', 'user', NULL, NULL,
  'fixture-creator', NULL, NULL, '1.0', 'LATE'
);

INSERT INTO analytics_event_dedupe (
  event_id, dedupe_key, schema_version, event_name, source_worker,
  occurred_at, received_at, hour_start, actor_type, content_id, content_type,
  creator_id, duration_ms, position, metric_version, projection_status
) VALUES (
  'fixture-read-dwell', 'fixture-dedupe-read-dwell', '1.0',
  'read_dwell', 'W03', '2026-11-08T12:15:34.000Z', '2026-11-08T12:15:35.000Z',
  '2026-11-08T12:00:00.000Z', 'user', 'fixture-content', 'article',
  NULL, 1200, 25.5, '1.0', 'PENDING'
);

INSERT INTO analytics_content_hourly (
  hour_start, content_id, content_type, metric_version, opens, likes
) VALUES ('2026-11-08T12:00:00.000Z', 'fixture-content', 'article', '1.0', 1, 1);

INSERT INTO analytics_creator_hourly (
  hour_start, creator_id, metric_version, followers_gained
) VALUES ('2026-11-08T12:00:00.000Z', 'fixture-creator', '1.0', 1);

INSERT INTO analytics_rollup_watermark (
  consumer_name, last_event_at, last_event_id
) VALUES ('fixture-consumer', '2026-11-08T12:00:00.000Z', 'fixture-event');

INSERT INTO analytics_reconciliation_status (
  reconciliation_id, source_worker, window_from, window_to, status, details_json
) VALUES (
  'fixture-reconciliation', 'W03', '2026-11-08T12:00:00.000Z',
  '2026-11-08T13:00:00.000Z', 'PASSED', '{"rowsChecked":1}'
);

INSERT INTO analytics_projection_rebuild_state (
  singleton_id, run_id, hour_start, status, started_at, completed_at,
  content_buckets_rebuilt, creator_buckets_rebuilt, error_code
) VALUES (
  1, 'fixture-rebuild', '2026-11-08T12:00:00.000Z', 'SUCCEEDED',
  '2026-11-08T13:00:00.000Z', '2026-11-08T13:00:01.000Z', 1, 1, NULL
);

DO $$
BEGIN
  BEGIN
    INSERT INTO analytics_event_dedupe (
      event_id, dedupe_key, schema_version, event_name, source_worker,
      occurred_at, received_at, hour_start, actor_type, content_id, content_type,
      metric_version
    ) VALUES (
      'fixture-invalid-w01-social', 'fixture-invalid-w01-social-dedupe', '1.0',
      'like_created', 'W01', '2026-11-08T12:00:00.000Z', '2026-11-08T12:00:00.000Z',
      '2026-11-08T12:00:00.000Z', 'user', 'fixture-content', 'article', '1.0'
    );
    RAISE EXCEPTION 'W01_MUST_NOT_EMIT_AUTHORITATIVE_SOCIAL_EVENTS';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO analytics_event_dedupe (
      event_id, dedupe_key, schema_version, event_name, source_worker,
      occurred_at, received_at, hour_start, actor_type, content_id, content_type,
      metric_version
    ) VALUES (
      'fixture-invalid-w05-content', 'fixture-invalid-w05-content-dedupe', '1.0',
      'content_open', 'W05', '2026-11-08T12:00:00.000Z', '2026-11-08T12:00:00.000Z',
      '2026-11-08T12:00:00.000Z', 'user', 'fixture-content', 'article', '1.0'
    );
    RAISE EXCEPTION 'W05_MUST_NOT_EMIT_W03_CONTENT_TELEMETRY';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO analytics_event_dedupe (
      event_id, dedupe_key, schema_version, event_name, source_worker,
      occurred_at, received_at, hour_start, actor_type, content_id, content_type,
      metric_version
    ) VALUES (
      'fixture-invalid-duration', 'fixture-invalid-duration-dedupe', '1.0',
      'read_dwell', 'W03', '2026-11-08T12:00:00.000Z', '2026-11-08T12:00:00.000Z',
      '2026-11-08T12:00:00.000Z', 'user', 'fixture-content', 'article', '1.0'
    );
    RAISE EXCEPTION 'DURATION_EVENTS_MUST_HAVE_POSITIVE_DURATION';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO analytics_event_dedupe (
      event_id, dedupe_key, schema_version, event_name, source_worker,
      occurred_at, received_at, hour_start, actor_type, content_id, content_type,
      metric_version
    ) VALUES (
      'fixture-invalid-social-visitor', 'fixture-invalid-social-visitor-dedupe', '1.0',
      'comment_created', 'W05', '2026-11-08T12:00:00.000Z', '2026-11-08T12:00:00.000Z',
      '2026-11-08T12:00:00.000Z', 'visitor', 'fixture-content', 'article', '1.0'
    );
    RAISE EXCEPTION 'SOCIAL_EVENTS_MUST_HAVE_AUTHENTICATED_ACTOR_TYPE';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO analytics_event_dedupe (
      event_id, dedupe_key, schema_version, event_name, source_worker,
      occurred_at, received_at, hour_start, actor_type, content_id, content_type,
      metric_version, projection_status
    ) VALUES (
      'fixture-invalid-late-status', 'fixture-invalid-late-status-dedupe', '1.0',
      'content_open', 'W01', '2026-11-08T12:00:00.000Z', '2026-11-08T12:00:00.000Z',
      '2026-11-08T12:00:00.000Z', 'visitor', 'fixture-content', 'article', '1.0', 'UNKNOWN'
    );
    RAISE EXCEPTION 'PROJECTION_STATUS_MUST_BE_ALLOWLISTED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO analytics_event_dedupe (
      event_id, dedupe_key, schema_version, event_name, source_worker,
      occurred_at, received_at, hour_start, actor_type, content_id, content_type,
      metric_version
    ) VALUES (
      'fixture-w01-content-open', 'fixture-another-dedupe', '1.0',
      'content_open', 'W01', '2026-11-08T12:00:00.000Z', '2026-11-08T12:00:00.000Z',
      '2026-11-08T12:00:00.000Z', 'visitor', 'fixture-content', 'article', '1.0'
    );
    RAISE EXCEPTION 'EVENT_ID_MUST_BE_UNIQUE';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO analytics_reconciliation_status (
      reconciliation_id, source_worker, window_from, window_to, status
    ) VALUES (
      'fixture-invalid-window', 'W03', '2026-11-08T13:00:00.000Z',
      '2026-11-08T12:00:00.000Z', 'PENDING'
    );
    RAISE EXCEPTION 'RECONCILIATION_WINDOW_MUST_BE_ORDERED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO analytics_projection_rebuild_state (
      singleton_id, run_id, hour_start, status, started_at
    ) VALUES (
      2, 'fixture-invalid-singleton', '2026-11-08T12:00:00.000Z',
      'RUNNING', '2026-11-08T13:00:00.000Z'
    );
    RAISE EXCEPTION 'REBUILD_STATE_MUST_BE_SINGLETON';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;

DO $$
DECLARE
  remaining_rows BIGINT;
BEGIN
  SELECT
    (SELECT count(*) FROM analytics_event_dedupe) +
    (SELECT count(*) FROM analytics_content_hourly) +
    (SELECT count(*) FROM analytics_creator_hourly) +
    (SELECT count(*) FROM analytics_rollup_watermark) +
    (SELECT count(*) FROM analytics_reconciliation_status) +
    (SELECT count(*) FROM analytics_projection_rebuild_state)
  INTO remaining_rows;
  IF remaining_rows <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK_LEFT_%_SYNTHETIC_ROWS', remaining_rows;
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'database', current_database(),
  'postgresMajor', 18,
  'domainId', 'D1-05',
  'worker', 'W11',
  'tables', 6,
  'explicitIndexes', 8,
  'foreignKeys', 0,
  'triggers', 0,
  'identityFieldsPersisted', false,
  'syntheticRowsAfterRollback', 0,
  'campaignSchemaInvented', false,
  'growthOperationSchemaInvented', false,
  'remoteNeonTouched', false,
  'cloudflareD1Touched', false,
  'businessDataImported', false,
  'productionCutoverAuthorized', false,
  'admissionStatus', 'BLOCKED_MISSING_RETENTION_DELETION_AND_CONSENT_PURPOSE_POLICIES'
) AS d1_05_w11_analytics_postflight;
