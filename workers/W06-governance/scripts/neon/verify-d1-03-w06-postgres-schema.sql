\set ON_ERROR_STOP on

DO $$
DECLARE
  table_count INTEGER;
  explicit_index_count INTEGER;
  foreign_key_count INTEGER;
  trigger_count INTEGER;
  timestamp_count INTEGER;
BEGIN
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'EXPECTED_POSTGRESQL_18';
  END IF;

  SELECT count(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = current_schema()
    AND table_type = 'BASE TABLE'
    AND table_name LIKE 'moderation_%';
  IF table_count <> 7 THEN
    RAISE EXCEPTION 'EXPECTED_7_MODERATION_TABLES_GOT_%', table_count;
  END IF;

  SELECT count(*) INTO explicit_index_count
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = ANY (ARRAY[
      'uq_moderation_cases_case_id',
      'ix_moderation_cases_queue',
      'ix_moderation_cases_reviewer_state',
      'uq_moderation_decisions_case_version',
      'ix_moderation_decisions_case_created',
      'ix_moderation_decisions_policy',
      'ix_moderation_idem_expiry',
      'ix_moderation_enforcement_outbox_ready',
      'ix_moderation_reports_target_created',
      'ix_moderation_reports_actor_created',
      'ix_moderation_report_idem_expiry'
    ]);
  IF explicit_index_count <> 11 THEN
    RAISE EXCEPTION 'EXPECTED_11_EXPLICIT_INDEXES_GOT_%', explicit_index_count;
  END IF;

  SELECT count(*) INTO foreign_key_count
  FROM information_schema.table_constraints
  WHERE constraint_schema = current_schema()
    AND constraint_type = 'FOREIGN KEY'
    AND table_name LIKE 'moderation_%';
  IF foreign_key_count <> 0 THEN
    RAISE EXCEPTION 'EXPECTED_ZERO_CROSS_DOMAIN_FOREIGN_KEYS_GOT_%', foreign_key_count;
  END IF;

  SELECT count(*) INTO trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname LIKE 'moderation_%'
    AND NOT t.tgisinternal;
  IF trigger_count <> 0 THEN
    RAISE EXCEPTION 'EXPECTED_ZERO_UNDECLARED_TRIGGERS_GOT_%', trigger_count;
  END IF;

  SELECT count(*) INTO timestamp_count
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name IN ('moderation_cases', 'moderation_decisions', 'moderation_reports')
    AND column_name IN ('created_at', 'updated_at', 'effective_at')
    AND data_type = 'timestamp with time zone';
  IF timestamp_count < 4 THEN
    RAISE EXCEPTION 'EXPECTED_NATIVE_TIMESTAMPTZ_COLUMNS_GOT_%', timestamp_count;
  END IF;

  IF to_regclass(format('%I.%I', current_schema(), 'audit_events')) IS NOT NULL THEN
    RAISE EXCEPTION 'W06_SCHEMA_MUST_NOT_DUPLICATE_W09_AUDIT_EVENTS';
  END IF;
  IF to_regclass(format('%I.%I', current_schema(), 'appeals')) IS NOT NULL
     OR to_regclass(format('%I.%I', current_schema(), 'moderation_appeals')) IS NOT NULL THEN
    RAISE EXCEPTION 'APPEAL_SCHEMA_MUST_NOT_BE_INVENTED_BEFORE_PERSISTENCE_ADMISSION';
  END IF;
END;
$$;

BEGIN;

INSERT INTO moderation_cases (
  case_id, target_type, target_id, target_version, policy_version, state,
  priority, assigned_reviewer_id, current_decision_id, evidence_bundle_ref,
  version, created_at, updated_at
) VALUES (
  'fixture-case', 'content', 'fixture-target', 1, 'policy-fixture', 'PENDING_REVIEW',
  3, 'fixture-reviewer', NULL, NULL, 1, now(), now()
);

INSERT INTO moderation_decisions (
  decision_id, case_id, case_version, outcome, target_type, target_id, target_version,
  policy_version, reason_code, severity, scope, effective_at, expires_at,
  source_kind, reviewer_id, reviewer_layer, request_id, created_at
) VALUES (
  'fixture-decision', 'fixture-case', 1, 'APPROVED', 'content', 'fixture-target', 1,
  'policy-fixture', 'fixture-reason', 'LOW', 'CONTENT', now(), NULL,
  'HUMAN', 'fixture-reviewer', 'L3', 'fixture-request', now()
);

INSERT INTO moderation_decision_idempotency (
  id, reviewer_id, case_id, idempotency_key, request_hash, decision_id,
  response_status, response_json, created_at, expires_at
) VALUES (
  'fixture-decision-idem', 'fixture-reviewer', 'fixture-case', 'fixture-key',
  'fixture-hash', 'fixture-decision', 200, '{}', now(), now() + interval '1 day'
);

INSERT INTO moderation_enforcement_outbox (
  outbox_id, decision_id, case_id, target_type, target_id, target_version,
  outcome, policy_version, idempotency_key, status, attempts, next_attempt_at,
  last_error, created_at, delivered_at
) VALUES (
  'fixture-outbox', 'fixture-decision', 'fixture-case', 'content', 'fixture-target',
  1, 'APPROVED', 'policy-fixture', 'fixture-outbox-key', 'PENDING', 0, now(),
  NULL, now(), NULL
);

INSERT INTO moderation_reports (
  report_id, actor_user_id, target_type, target_id, reason_code, description,
  evidence_refs_json, policy_version, dedup_bucket, created_at
) VALUES (
  'fixture-report', 'fixture-actor', 'content', 'fixture-target', 'spam',
  NULL, '["evidence://fixture"]'::jsonb, 'policy-fixture', 'bucket-fixture', now()
);

INSERT INTO moderation_report_idempotency (
  id, actor_user_id, idempotency_key, request_hash, report_id,
  response_status, response_json, created_at, expires_at
) VALUES (
  'fixture-report-idem', 'fixture-actor', 'fixture-report-key',
  'fixture-report-hash', 'fixture-report', 201, '{}', now(), now() + interval '1 day'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO moderation_txn_guard (id, successful) VALUES (2, 1);
    RAISE EXCEPTION 'TRANSACTION_GUARD_ID_CHECK_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO moderation_txn_guard (id, successful) VALUES (1, 0);
    RAISE EXCEPTION 'TRANSACTION_GUARD_SUCCESS_CHECK_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO moderation_reports (
      report_id, actor_user_id, target_type, target_id, reason_code,
      evidence_refs_json, policy_version, dedup_bucket, created_at
    ) VALUES (
      'fixture-invalid-target', 'actor', 'unknown', 'target', 'reason',
      '[]'::jsonb, 'policy', 'bucket', now()
    );
    RAISE EXCEPTION 'REPORT_TARGET_TYPE_CHECK_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO moderation_reports (
      report_id, actor_user_id, target_type, target_id, reason_code,
      evidence_refs_json, policy_version, dedup_bucket, created_at
    ) VALUES (
      'fixture-invalid-evidence', 'actor', 'content', 'target', 'reason',
      '{}'::jsonb, 'policy', 'bucket', now()
    );
    RAISE EXCEPTION 'REPORT_EVIDENCE_ARRAY_CHECK_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO moderation_enforcement_outbox (
      outbox_id, decision_id, case_id, target_type, target_id, target_version,
      outcome, policy_version, idempotency_key, status, attempts, next_attempt_at, created_at
    ) VALUES (
      'fixture-invalid-outbox', 'another-decision', 'fixture-case', 'comment',
      'target', 1, 'APPROVED', 'policy', 'key', 'PENDING', 0, now(), now()
    );
    RAISE EXCEPTION 'OUTBOX_TARGET_TYPE_CHECK_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO moderation_enforcement_outbox (
      outbox_id, decision_id, case_id, target_type, target_id, target_version,
      outcome, policy_version, idempotency_key, status, attempts, next_attempt_at, created_at
    ) VALUES (
      'fixture-invalid-status', 'third-decision', 'fixture-case', 'content',
      'target', 1, 'APPROVED', 'policy', 'key', 'UNKNOWN', 0, now(), now()
    );
    RAISE EXCEPTION 'OUTBOX_STATUS_CHECK_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO moderation_decisions (
      decision_id, case_id, case_version, outcome, target_type, target_id,
      policy_version, reason_code, severity, scope, effective_at,
      source_kind, request_id, created_at
    ) VALUES (
      'fixture-duplicate-decision', 'fixture-case', 1, 'REJECTED', 'content',
      'fixture-target', 'policy', 'reason', 'LOW', 'CONTENT', now(),
      'HUMAN', 'request-duplicate', now()
    );
    RAISE EXCEPTION 'DECISION_CASE_VERSION_UNIQUENESS_NOT_ENFORCED';
  EXCEPTION WHEN unique_violation THEN
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
    (SELECT count(*) FROM moderation_cases) +
    (SELECT count(*) FROM moderation_decisions) +
    (SELECT count(*) FROM moderation_decision_idempotency) +
    (SELECT count(*) FROM moderation_txn_guard) +
    (SELECT count(*) FROM moderation_enforcement_outbox) +
    (SELECT count(*) FROM moderation_reports) +
    (SELECT count(*) FROM moderation_report_idempotency)
  INTO remaining_rows;
  IF remaining_rows <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK_LEFT_%_FIXTURE_ROWS', remaining_rows;
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'database', current_database(),
  'postgresMajor', 18,
  'tables', 7,
  'explicitIndexes', 11,
  'triggers', 0,
  'triggerFunctions', 0,
  'foreignKeys', 0,
  'appealSchemaAdmitted', false,
  'auditEventsDuplicated', false,
  'rowsAfterRollback', 0,
  'businessDataImported', false,
  'remoteNeonTouched', false,
  'cloudflareD1Touched', false
) AS d1_03_w06_moderation_postflight;
