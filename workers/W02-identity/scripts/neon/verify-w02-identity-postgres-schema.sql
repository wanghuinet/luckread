\set ON_ERROR_STOP on

DO $$
DECLARE
  expected_tables TEXT[] := ARRAY[
    'user',
    'session',
    'account',
    'verification',
    'twoFactor',
    'role_assignments',
    'role_authorization_versions',
    'auth_identities',
    'auth_credentials',
    'auth_013_publication_journal',
    'auth_010_session_revocation_journal',
    'auth_username_change_state',
    'auth_007_mfa_publication_journal',
    'auth_007_mfa_operation_receipts'
  ];
  missing_tables TEXT[];
  found_tables INTEGER;
  trigger_count INTEGER;
  function_count INTEGER;
  remaining_rows BIGINT;
BEGIN
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'EXPECTED_POSTGRESQL_18';
  END IF;

  SELECT array_agg(expected_name)
    INTO missing_tables
    FROM unnest(expected_tables) AS expected(expected_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.tables t
      WHERE t.table_schema = current_schema()
        AND t.table_type = 'BASE TABLE'
        AND t.table_name = expected.expected_name
   );
  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'MISSING_W02_TABLES_%', array_to_string(missing_tables, ',');
  END IF;

  SELECT count(*) INTO found_tables
    FROM information_schema.tables
   WHERE table_schema = current_schema()
     AND table_type = 'BASE TABLE'
     AND table_name = ANY(expected_tables);
  IF found_tables <> 14 THEN
    RAISE EXCEPTION 'EXPECTED_14_W02_TABLES_GOT_%', found_tables;
  END IF;

  IF to_regclass(format('%I.%I', current_schema(), 'users')) IS NOT NULL
     OR to_regclass(format('%I.%I', current_schema(), 'media')) IS NOT NULL THEN
    RAISE EXCEPTION 'W02_SCHEMA_MUST_NOT_CREATE_W01_PAYLOAD_TABLES';
  END IF;

  IF to_regclass(format('%I.%I', current_schema(), 'l8_genesis_bootstrap_audit')) IS NOT NULL THEN
    RAISE EXCEPTION 'UNMERGED_L8_GENESIS_CHANGE_CONTROL_MUST_NOT_BE_INCLUDED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION 'BTREE_GIST_EXTENSION_REQUIRED_FOR_ROLE_ASSIGNMENT_INTERVAL_EXCLUSION';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'role_assignments'::regclass
       AND conname = 'role_assignments_no_active_overlap'
       AND contype = 'x'
  ) THEN
    RAISE EXCEPTION 'ROLE_ASSIGNMENT_ACTIVE_INTERVAL_EXCLUSION_CONSTRAINT_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'user'
       AND column_name = 'account_state'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'user'
       AND column_name = 'account_state_version'
  ) THEN
    RAISE EXCEPTION 'BETTER_AUTH_ACCOUNT_STATE_FIELDS_MISSING';
  END IF;

  SELECT count(*) INTO trigger_count
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = current_schema()
     AND NOT t.tgisinternal
     AND c.relname = ANY(expected_tables);
  IF trigger_count <> 7 THEN
    RAISE EXCEPTION 'EXPECTED_7_W02_DOMAIN_TRIGGERS_GOT_%', trigger_count;
  END IF;

  SELECT count(*) INTO function_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = current_schema()
     AND p.proname = ANY(ARRAY[
       'advance_role_authorization_version',
       'w02_user_mfa_enable_revoke_sessions_fn',
       'w02_user_mfa_disable_clear_enrollment_fn',
       'w02_auth_username_identity_projection_sync_fn',
       'w02_auth_user_previous_username_reservation_guard_fn'
     ]);
  IF function_count <> 5 THEN
    RAISE EXCEPTION 'EXPECTED_5_W02_TRIGGER_FUNCTIONS_GOT_%', function_count;
  END IF;

  SELECT
    (SELECT count(*) FROM "user") +
    (SELECT count(*) FROM "session") +
    (SELECT count(*) FROM "account") +
    (SELECT count(*) FROM "verification") +
    (SELECT count(*) FROM "twoFactor") +
    (SELECT count(*) FROM role_assignments) +
    (SELECT count(*) FROM role_authorization_versions) +
    (SELECT count(*) FROM auth_identities) +
    (SELECT count(*) FROM auth_credentials) +
    (SELECT count(*) FROM auth_013_publication_journal) +
    (SELECT count(*) FROM auth_010_session_revocation_journal) +
    (SELECT count(*) FROM auth_username_change_state) +
    (SELECT count(*) FROM auth_007_mfa_publication_journal) +
    (SELECT count(*) FROM auth_007_mfa_operation_receipts)
    INTO remaining_rows;
  IF remaining_rows <> 0 THEN
    RAISE EXCEPTION 'W02_VERIFIER_ROWS_REMAIN_%', remaining_rows;
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'database', current_database(),
  'postgresMajor', 18,
  'betterAuthVersion', '1.7.8',
  'betterAuthCoreTables', 5,
  'customW02Tables', 9,
  'totalTables', 14,
  'domainTriggers', 7,
  'triggerFunctions', 5,
  'l8GenesisBootstrapTableIncluded', false,
  'payloadUsersTableIncluded', false,
  'remainingSyntheticRows', 0,
  'businessDataImported', false,
  'remoteNeonTouched', false,
  'cloudflareD1Touched', false
) AS d1_01_w02_identity_postflight;
