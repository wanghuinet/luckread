\\set ON_ERROR_STOP on

DO $$
DECLARE
  table_count INTEGER;
  named_index_count INTEGER;
  foreign_key_count INTEGER;
BEGIN
  SELECT count(*) INTO table_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'jobs', 'job_retries', 'execution_dead_letters',
      'execution_inbox', 'execution_outbox', 'operational_idempotency'
    );
  IF table_count <> 6 THEN
    RAISE EXCEPTION 'W10_TABLE_COUNT_EXPECTED_6_GOT_%', table_count;
  END IF;

  SELECT count(*) INTO named_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_jobs_owner_state_updated',
      'idx_jobs_expires_at',
      'idx_job_retries_next_attempt',
      'idx_execution_dead_letters_state_first_seen',
      'idx_execution_inbox_state_received',
      'idx_execution_outbox_delivery',
      'idx_operational_idempotency_expires_at'
    );
  IF named_index_count <> 7 THEN
    RAISE EXCEPTION 'W10_EXPLICIT_INDEX_COUNT_EXPECTED_7_GOT_%', named_index_count;
  END IF;

  SELECT count(*) INTO foreign_key_count
  FROM pg_constraint
  WHERE contype = 'f'
    AND conrelid IN (
      'jobs'::regclass,
      'job_retries'::regclass,
      'execution_dead_letters'::regclass,
      'execution_inbox'::regclass,
      'execution_outbox'::regclass,
      'operational_idempotency'::regclass
    );
  IF foreign_key_count <> 2 THEN
    RAISE EXCEPTION 'W10_SAME_OWNER_FK_COUNT_EXPECTED_2_GOT_%', foreign_key_count;
  END IF;
END;
$$;

BEGIN;

INSERT INTO jobs (
  job_id, operation_id, operation_type, owner_worker, owner_task_id,
  resource_type, resource_id, actor_id, scope, state, created_at,
  updated_at, expires_at, idempotency_key, correlation_id, request_id
) VALUES (
  'job-w10-rehearsal', 'op-w10-rehearsal', 'moderation-enforcement',
  'W06', 'T21', 'ModerationCase', 'case-rehearsal', 'actor-rehearsal',
  'moderation:case:case-rehearsal', 'QUEUED',
  TIMESTAMPTZ '2026-11-09T00:00:00Z', TIMESTAMPTZ '2026-11-09T00:00:00Z',
  TIMESTAMPTZ '2026-11-10T00:00:00Z', 'idem-w10-rehearsal-0001',
  'corr-w10-rehearsal', 'req-w10-rehearsal'
);

INSERT INTO job_retries (
  retry_id, job_id, attempt_number, failure_class, error_code,
  error_summary, scheduled_at, created_at
) VALUES (
  'retry-w10-rehearsal', 'job-w10-rehearsal', 1, 'transient',
  'DEPENDENCY_TIMEOUT', 'Sanitized dependency timeout',
  TIMESTAMPTZ '2026-11-09T00:00:01Z', TIMESTAMPTZ '2026-11-09T00:00:00Z'
);

INSERT INTO execution_dead_letters (
  dlq_id, event_id, consumer_name, original_event_metadata_json,
  payload_sha256, attempt_count, last_error_class, last_error_summary,
  first_seen_at, last_seen_at
) VALUES (
  'dlq-w10-rehearsal', 'event-w10-rehearsal', 'w06-moderation-consumer',
  '{"eventId":"event-w10-rehearsal","producer":"W06","schemaVersion":"1.0"}',
  repeat('a', 64), 3, 'poison', 'Sanitized invalid event metadata',
  TIMESTAMPTZ '2026-11-09T00:00:02Z', TIMESTAMPTZ '2026-11-09T00:00:03Z'
);

INSERT INTO execution_inbox (
  consumer_name, event_id, event_type, schema_version, producer,
  resource_type, resource_id, idempotency_key, source_version,
  correlation_id, causation_id, payload_sha256, status, received_at, processed_at
) VALUES (
  'w06-moderation-consumer', 'event-w10-inbox-rehearsal',
  'moderation.case.queued', '1.0', 'W06', 'ModerationCase',
  'case-rehearsal', 'idem-w10-inbox-0001', 1, 'corr-w10-rehearsal',
  'cause-w10-rehearsal', repeat('b', 64), 'APPLIED',
  TIMESTAMPTZ '2026-11-09T00:00:04Z', TIMESTAMPTZ '2026-11-09T00:00:05Z'
);

INSERT INTO execution_outbox (
  outbox_id, event_id, event_type, schema_version, producer,
  resource_type, resource_id, occurred_at, correlation_id, causation_id,
  idempotency_key, source_version, payload_ref, payload_sha256,
  status, attempts, created_at, published_at
) VALUES (
  'outbox-w10-rehearsal', 'event-w10-outbox-rehearsal',
  'async.operation.completed', '1.0', 'W10', 'Job', 'job-w10-rehearsal',
  TIMESTAMPTZ '2026-11-09T00:00:06Z', 'corr-w10-rehearsal',
  'cause-w10-rehearsal', 'idem-w10-outbox-0001', 1,
  'opaque://rehearsal/payload-ref', repeat('c', 64),
  'PUBLISHED', 1, TIMESTAMPTZ '2026-11-09T00:00:06Z',
  TIMESTAMPTZ '2026-11-09T00:00:07Z'
);

INSERT INTO operational_idempotency (
  idempotency_id, owner_worker, operation_type, scope, idempotency_key,
  request_hash, operation_id, created_at, expires_at
) VALUES (
  'idem-row-w10-rehearsal', 'W06', 'moderation-enforcement',
  'moderation:case:case-rehearsal', 'idem-w10-rehearsal-0001',
  repeat('d', 64), 'op-w10-rehearsal',
  TIMESTAMPTZ '2026-11-09T00:00:00Z', TIMESTAMPTZ '2026-11-10T00:00:00Z'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO operational_idempotency (
      idempotency_id, owner_worker, operation_type, scope, idempotency_key,
      request_hash, operation_id, created_at, expires_at
    ) VALUES (
      'idem-row-w10-duplicate', 'W06', 'moderation-enforcement',
      'moderation:case:case-rehearsal', 'idem-w10-rehearsal-0001',
      repeat('e', 64), 'op-w10-rehearsal',
      TIMESTAMPTZ '2026-11-09T00:00:00Z', TIMESTAMPTZ '2026-11-10T00:00:00Z'
    );
    RAISE EXCEPTION 'W10_OPERATIONAL_IDEMPOTENCY_DUPLICATE_WAS_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;

DO $$
DECLARE
  business_rows BIGINT;
BEGIN
  SELECT
    (SELECT count(*) FROM jobs) +
    (SELECT count(*) FROM job_retries) +
    (SELECT count(*) FROM execution_dead_letters) +
    (SELECT count(*) FROM execution_inbox) +
    (SELECT count(*) FROM execution_outbox) +
    (SELECT count(*) FROM operational_idempotency)
  INTO business_rows;
  IF business_rows <> 0 THEN
    RAISE EXCEPTION 'W10_ROLLBACK_INVARIANT_FAILED_ROWS_%', business_rows;
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'database', current_database(),
  'postgresMajor', current_setting('server_version_num')::integer / 10000,
  'tables', 6,
  'explicitIndexes', 7,
  'foreignKeys', 2,
  'businessFixtureRowsAfterRollback', 0,
  'remoteNeonTouched', false,
  'cloudflareD1Touched', false,
  'w10RuntimeBindingAdded', false,
  'productionCutoverAuthorized', false
) AS d1_03_w10_execution_postflight;
