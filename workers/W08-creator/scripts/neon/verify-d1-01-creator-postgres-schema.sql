\set ON_ERROR_STOP on
BEGIN;

DO $w08_creator_schema_verify$
DECLARE
  actual_names TEXT[];
  expected_names TEXT[];
  expected_tables TEXT[] := ARRAY[
    'creator_applications',
    'creator_authorization_audit',
    'creators'
  ];
BEGIN
  IF current_database() <> 'luckread_schema' THEN
    RAISE EXCEPTION 'W08 schema verifier must run only against luckread_schema';
  END IF;
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'W08 schema verifier requires PostgreSQL 18';
  END IF;

  SELECT array_agg(table_name ORDER BY table_name)
    INTO actual_names
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE';
  IF actual_names IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'W08 isolated database must contain exactly three creator tables; found %', actual_names;
  END IF;

  IF (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'creator_applications') <> 14
     OR (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'creators') <> 8
     OR (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'creator_authorization_audit') <> 13 THEN
    RAISE EXCEPTION 'W08 exact table column counts drifted';
  END IF;

  expected_names := ARRAY[
    'application_id', 'application_idempotency_key', 'created_at', 'creator_type',
    'decided_at', 'decided_by', 'decision_idempotency_key', 'decision_reason',
    'grant_state', 'statement', 'status', 'updated_at', 'user_id', 'version'
  ];
  SELECT array_agg(column_name ORDER BY column_name)
    INTO actual_names
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'creator_applications';
  IF actual_names IS DISTINCT FROM expected_names THEN
    RAISE EXCEPTION 'creator_applications field contract drift: %', actual_names;
  END IF;

  expected_names := ARRAY[
    'application_id', 'created_at', 'creator_id', 'creator_type',
    'status', 'updated_at', 'user_id', 'version'
  ];
  SELECT array_agg(column_name ORDER BY column_name)
    INTO actual_names
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'creators';
  IF actual_names IS DISTINCT FROM expected_names THEN
    RAISE EXCEPTION 'creators field contract drift: %', actual_names;
  END IF;

  expected_names := ARRAY[
    'actor_id', 'audit_id', 'correlation_id', 'details_json', 'event_key',
    'event_type', 'from_state', 'idempotency_key', 'occurred_at',
    'resource_id', 'resource_type', 'subject_id', 'to_state'
  ];
  SELECT array_agg(column_name ORDER BY column_name)
    INTO actual_names
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'creator_authorization_audit';
  IF actual_names IS DISTINCT FROM expected_names THEN
    RAISE EXCEPTION 'creator_authorization_audit field contract drift: %', actual_names;
  END IF;

  IF (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'timestamp with time zone'
        AND (
          (table_name = 'creator_applications' AND column_name IN ('created_at', 'updated_at', 'decided_at'))
          OR (table_name = 'creators' AND column_name IN ('created_at', 'updated_at'))
          OR (table_name = 'creator_authorization_audit' AND column_name = 'occurred_at')
        )) <> 6 THEN
    RAISE EXCEPTION 'All six D1 UTC timestamp fields must map to PostgreSQL TIMESTAMPTZ';
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'creator_authorization_audit'
        AND column_name = 'details_json') <> 'text'
     OR (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'creator_authorization_audit'
        AND column_name = 'details_json') <> '''{}''::text' THEN
    RAISE EXCEPTION 'details_json must remain TEXT with the source {} default';
  END IF;

  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'creator_applications'
        AND column_name = 'version') <> '1'
     OR (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'creators'
        AND column_name = 'version') <> '1'
     OR (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'creator_applications'
        AND column_name = 'statement') <> ''''::text' THEN
    RAISE EXCEPTION 'W08 source defaults for statement/version drifted';
  END IF;

  SELECT array_agg(indexname ORDER BY indexname)
    INTO actual_names
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'creator_applications_one_pending_per_user',
        'creator_applications_status_created_idx',
        'creators_status_idx',
        'creator_authorization_audit_subject_time_idx',
        'creator_authorization_audit_resource_time_idx'
      );
  expected_names := ARRAY[
    'creator_applications_one_pending_per_user',
    'creator_applications_status_created_idx',
    'creator_authorization_audit_resource_time_idx',
    'creator_authorization_audit_subject_time_idx',
    'creators_status_idx'
  ];
  IF actual_names IS DISTINCT FROM expected_names THEN
    RAISE EXCEPTION 'W08 explicit index set drifted: %', actual_names;
  END IF;
  IF (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public'
      AND indexname IN (
        'creator_applications_one_pending_per_user',
        'creator_applications_status_created_idx',
        'creators_status_idx',
        'creator_authorization_audit_subject_time_idx',
        'creator_authorization_audit_resource_time_idx'
      )) <> 5 THEN
    RAISE EXCEPTION 'W08 must have exactly five explicit source indexes, including the pending-app partial unique index';
  END IF;

  IF (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid IN (
        'creator_applications'::regclass,
        'creators'::regclass,
        'creator_authorization_audit'::regclass
      ) AND contype = 'f') <> 0 THEN
    RAISE EXCEPTION 'W08 creator schema must not introduce cross-domain foreign keys';
  END IF;
  IF (SELECT COUNT(*) FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND c.relname = ANY(expected_tables)) <> 0 THEN
    RAISE EXCEPTION 'W08 source migration defines no table triggers';
  END IF;

  IF (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid = 'creator_applications'::regclass AND contype = 'p') <> 1
     OR (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid = 'creators'::regclass AND contype = 'p') <> 1
     OR (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid = 'creator_authorization_audit'::regclass AND contype = 'p') <> 1
     OR (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid = 'creator_applications'::regclass AND contype = 'u') <> 1
     OR (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid = 'creators'::regclass AND contype = 'u') <> 2
     OR (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid = 'creator_authorization_audit'::regclass AND contype = 'u') <> 1 THEN
    RAISE EXCEPTION 'W08 primary/unique constraint count drifted';
  END IF;

  -- A user may have only one PENDING application, while its historical rejected/approved
  -- applications remain available and idempotency keys are scoped to that user.
  INSERT INTO creator_applications
    (application_id, user_id, creator_type, status, grant_state,
     application_idempotency_key, created_at, updated_at)
  VALUES
    ('w08-fixture-app-1', 'w08-fixture-user', 'WRITER', 'PENDING', 'NOT_REQUESTED',
     'w08-fixture-idempotency-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

  BEGIN
    INSERT INTO creator_applications
      (application_id, user_id, creator_type, status, grant_state,
       application_idempotency_key, created_at, updated_at)
    VALUES
      ('w08-fixture-app-idem-duplicate', 'w08-fixture-user', 'WRITER', 'REJECTED', 'NOT_REQUESTED',
       'w08-fixture-idempotency-1', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
    RAISE EXCEPTION 'Expected user-scoped application idempotency key to be unique';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO creator_applications
      (application_id, user_id, creator_type, status, grant_state,
       application_idempotency_key, created_at, updated_at)
    VALUES
      ('w08-fixture-app-pending-duplicate', 'w08-fixture-user', 'DEVELOPER', 'PENDING', 'NOT_REQUESTED',
       'w08-fixture-idempotency-2', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
    RAISE EXCEPTION 'Expected one pending application per user to be enforced';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO creator_applications
    (application_id, user_id, creator_type, status, grant_state,
     application_idempotency_key, created_at, updated_at)
  VALUES
    ('w08-fixture-app-history', 'w08-fixture-user', 'WRITER', 'REJECTED', 'NOT_REQUESTED',
     'w08-fixture-idempotency-history', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z');

  BEGIN
    INSERT INTO creator_applications
      (application_id, user_id, creator_type, status, grant_state,
       application_idempotency_key, created_at, updated_at)
    VALUES
      ('w08-fixture-app-invalid-type', 'w08-invalid-type-user', 'ROOT', 'PENDING', 'NOT_REQUESTED',
       'w08-invalid-type-key', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    RAISE EXCEPTION 'Expected invalid creator application type to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO creator_applications
      (application_id, user_id, creator_type, status, grant_state,
       application_idempotency_key, created_at, updated_at)
    VALUES
      ('w08-fixture-app-invalid-status', 'w08-invalid-status-user', 'WRITER', 'ACTIVE', 'NOT_REQUESTED',
       'w08-invalid-status-key', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    RAISE EXCEPTION 'Expected invalid creator application status to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO creator_applications
      (application_id, user_id, creator_type, status, grant_state,
       application_idempotency_key, created_at, updated_at, version)
    VALUES
      ('w08-fixture-app-invalid-version', 'w08-invalid-version-user', 'WRITER', 'PENDING', 'NOT_REQUESTED',
       'w08-invalid-version-key', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0);
    RAISE EXCEPTION 'Expected non-positive creator application version to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- The application/creator user IDs are opaque W02 references. The W08 schema
  -- deliberately has no USER or RoleAssignment table and does not add cross-domain FKs.
  INSERT INTO creators
    (creator_id, user_id, application_id, creator_type, status, created_at, updated_at)
  VALUES
    ('w08-fixture-creator-1', 'w08-fixture-user', 'w08-fixture-app-1',
     'WRITER', 'PENDING_ROLE_GRANT', '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z');

  BEGIN
    INSERT INTO creators
      (creator_id, user_id, application_id, creator_type, status, created_at, updated_at)
    VALUES
      ('w08-fixture-creator-user-duplicate', 'w08-fixture-user', 'w08-other-application',
       'WRITER', 'ACTIVE', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z');
    RAISE EXCEPTION 'Expected one creator identity per user';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO creators
      (creator_id, user_id, application_id, creator_type, status, created_at, updated_at)
    VALUES
      ('w08-fixture-creator-application-duplicate', 'w08-other-user', 'w08-fixture-app-1',
       'WRITER', 'ACTIVE', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z');
    RAISE EXCEPTION 'Expected one creator record per application';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO creators
      (creator_id, user_id, application_id, creator_type, status, created_at, updated_at)
    VALUES
      ('w08-fixture-creator-invalid-status', 'w08-invalid-creator-user', 'w08-invalid-creator-app',
       'WRITER', 'PENDING', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z');
    RAISE EXCEPTION 'Expected invalid creator lifecycle status to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- resource_type='role_assignment' remains an audit reference string only.
  INSERT INTO creator_authorization_audit
    (audit_id, event_key, actor_id, subject_id, event_type,
     resource_type, resource_id, occurred_at)
  VALUES
    ('w08-fixture-audit-1', 'w08-fixture-event-1', 'w08-fixture-admin',
     'w08-fixture-user', 'CREATOR_ROLE_GRANTED', 'role_assignment',
     'w08-opaque-role-assignment-id', '2026-01-06T00:00:00Z');

  IF (SELECT details_json FROM creator_authorization_audit
      WHERE audit_id = 'w08-fixture-audit-1') <> '{}' THEN
    RAISE EXCEPTION 'creator audit details default must remain {}';
  END IF;

  BEGIN
    INSERT INTO creator_authorization_audit
      (audit_id, event_key, actor_id, subject_id, event_type,
       resource_type, resource_id, occurred_at)
    VALUES
      ('w08-fixture-audit-event-duplicate', 'w08-fixture-event-1', 'w08-fixture-admin',
       'w08-fixture-user', 'CREATOR_ROLE_GRANTED', 'role_assignment',
       'w08-another-role-assignment-id', '2026-01-07T00:00:00Z');
    RAISE EXCEPTION 'Expected creator authorization audit event_key to be unique';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO creator_authorization_audit
      (audit_id, event_key, actor_id, subject_id, event_type,
       resource_type, resource_id, occurred_at)
    VALUES
      ('w08-fixture-audit-invalid-event', 'w08-fixture-event-invalid', 'w08-fixture-admin',
       'w08-fixture-user', 'CREATOR_ROLE_REVOKED', 'creator',
       'w08-fixture-creator-1', '2026-01-07T00:00:00Z');
    RAISE EXCEPTION 'Expected invalid creator authorization event to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO creator_authorization_audit
      (audit_id, event_key, actor_id, subject_id, event_type,
       resource_type, resource_id, occurred_at)
    VALUES
      ('w08-fixture-audit-invalid-resource', 'w08-fixture-event-resource', 'w08-fixture-admin',
       'w08-fixture-user', 'CREATOR_ROLE_GRANTED', 'membership_subscription',
       'w08-fixture-subscription', '2026-01-07T00:00:00Z');
    RAISE EXCEPTION 'Expected invalid creator audit resource type to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO creator_authorization_audit
      (audit_id, event_key, actor_id, subject_id, event_type,
       resource_type, resource_id, occurred_at)
    VALUES
      ('w08-fixture-audit-duplicate-id', 'w08-fixture-event-id', 'w08-fixture-admin',
       'w08-fixture-user', 'CREATOR_ROLE_GRANTED', 'creator',
       'w08-fixture-creator-1', '2026-01-07T00:00:00Z');
    RAISE EXCEPTION 'Expected invalid audit primary identifier replay to fail';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$w08_creator_schema_verify$;

ROLLBACK;

SELECT jsonb_build_object(
  'status', 'W08_D1_01_CREATOR_POSTGRES_SCHEMA_PASS',
  'postgresMajor', 18,
  'tablesVerified', 3,
  'explicitIndexesVerified', 5,
  'primaryConstraintsVerified', 3,
  'uniqueConstraintsVerified', 4,
  'foreignKeys', 0,
  'triggers', 0,
  'checks', jsonb_build_array(
    'exact 14/8/13 source columns',
    'six D1 UTC timestamp fields mapped to TIMESTAMPTZ',
    'user_id and audit resource_id remain opaque W02 references',
    'one pending creator application per user',
    'user-scoped application idempotency uniqueness',
    'one creator per user and one creator record per application',
    'source-defined creator/audit state vocabularies',
    'audit event_key idempotency and role_assignment audit label',
    'details_json remains TEXT with {} default',
    'no W02 RoleAssignment, user, W07 subscription or D1-04 financial table',
    'all synthetic rows rolled back'
  ),
  'businessRowsAfterRollback', jsonb_build_object(
    'creator_applications', (SELECT COUNT(*) FROM creator_applications),
    'creators', (SELECT COUNT(*) FROM creators),
    'creator_authorization_audit', (SELECT COUNT(*) FROM creator_authorization_audit)
  ),
  'productionDatabaseTouched', false,
  'businessDataImported', false
) AS evidence;
