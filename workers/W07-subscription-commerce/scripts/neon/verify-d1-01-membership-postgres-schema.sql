\set ON_ERROR_STOP on
BEGIN;

DO $w07_membership_schema_verify$
DECLARE
  actual_columns TEXT[];
  expected_columns TEXT[];
  actual_count INTEGER;
  -- The verifier still checks W07's exact six-table owner slice, while allowing
  -- only the registered W01/W02/W07/W08 owner tables in the integrated D1-01 rehearsal.
  known_d1_01_tables TEXT[] := ARRAY[
    'users_sessions',
    'users',
    'media',
    'redirects',
    'redirects_rels',
    'payload_kv',
    'payload_locked_documents',
    'payload_locked_documents_rels',
    'payload_preferences',
    'payload_preferences_rels',
    'payload_migrations',
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
    'auth_007_mfa_operation_receipts',
    'membership_plan_versions',
    'membership_plans',
    'membership_revenuecat_product_bindings',
    'membership_subscription_plan_change_attempts',
    'membership_subscription_scheduled_plan_changes',
    'membership_subscriptions',
    'creator_applications',
    'creators',
    'creator_authorization_audit',
    'neon_schema_migration_ledger'
  ];
  expected_tables TEXT[] := ARRAY[
    'membership_plan_versions',
    'membership_plans',
    'membership_revenuecat_product_bindings',
    'membership_subscription_plan_change_attempts',
    'membership_subscription_scheduled_plan_changes',
    'membership_subscriptions'
  ];
BEGIN
  IF current_database() <> 'luckread_schema' THEN
    RAISE EXCEPTION 'W07 schema verifier must run only against luckread_schema';
  END IF;
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'W07 schema verifier requires PostgreSQL 18';
  END IF;

  SELECT array_agg(table_name ORDER BY table_name)
    INTO actual_columns
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name = ANY(expected_tables);
  IF actual_columns IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'W07 expected six D1-01 membership tables; found %', actual_columns;
  END IF;
  SELECT COUNT(*)::INTEGER INTO actual_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND NOT (table_name = ANY(known_d1_01_tables));
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected table outside the registered D1-01 W01/W02/W07/W08 owners and shared migration ledger: %', actual_count;
  END IF;

  expected_columns := ARRAY[
    'cancel_at', 'created_at', 'creator_id', 'current_period_end',
    'current_period_start', 'entitlement_snapshot_ref', 'plan_id', 'plan_version',
    'started_at', 'status', 'subscriber_id', 'subscription_id',
    'trial_converted_at', 'trial_ends_at', 'trial_started_at', 'updated_at', 'version'
  ];
  SELECT array_agg(column_name ORDER BY column_name)
    INTO actual_columns
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'membership_subscriptions';
  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION 'membership_subscriptions columns drift: %', actual_columns;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'membership_subscriptions'
          AND column_name IN ('started_at', 'current_period_start', 'current_period_end',
            'cancel_at', 'created_at', 'updated_at', 'trial_started_at', 'trial_ends_at', 'trial_converted_at')
          AND data_type <> 'timestamp with time zone')
        OR
        (table_name = 'membership_plan_versions'
          AND column_name = 'created_at' AND data_type <> 'timestamp with time zone')
        OR
        (table_name = 'membership_plans'
          AND column_name IN ('created_at', 'updated_at') AND data_type <> 'timestamp with time zone')
        OR
        (table_name = 'membership_revenuecat_product_bindings'
          AND column_name IN ('created_at', 'retired_at') AND data_type <> 'timestamp with time zone')
        OR
        (table_name = 'membership_subscription_plan_change_attempts'
          AND column_name IN ('current_period_start', 'current_period_end', 'expires_at',
            'applied_at', 'created_at', 'updated_at') AND data_type <> 'timestamp with time zone')
        OR
        (table_name = 'membership_subscription_scheduled_plan_changes'
          AND column_name IN ('effective_at', 'applied_at', 'created_at', 'updated_at')
          AND data_type <> 'timestamp with time zone')
      )
  ) THEN
    RAISE EXCEPTION 'D1 ISO-8601 timestamp fields must map to PostgreSQL TIMESTAMPTZ';
  END IF;

  IF (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'membership_plans') <> 9
     OR (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'membership_plan_versions') <> 10
     OR (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'membership_revenuecat_product_bindings') <> 8
     OR (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'membership_subscription_plan_change_attempts') <> 19
     OR (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'membership_subscription_scheduled_plan_changes') <> 17 THEN
    RAISE EXCEPTION 'W07 plan, RevenueCat, upgrade-attempt or scheduled-change column counts drifted';
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'membership_subscriptions'
        AND column_name = 'version') <> 'integer'
     OR (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'membership_subscriptions'
        AND column_name = 'version') <> '1' THEN
    RAISE EXCEPTION 'membership_subscriptions.version must be INTEGER DEFAULT 1';
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'membership_plan_versions'
        AND column_name = 'benefits_json') <> 'text'
     OR (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'membership_plan_versions'
        AND column_name = 'benefits_json') <> '''[]''::text' THEN
    RAISE EXCEPTION 'benefits_json must remain TEXT with default []';
  END IF;

  IF (SELECT COUNT(*) FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'ix_membership_subscriptions_subscriber_status_period',
          'ix_membership_subscriptions_plan_version',
          'ix_membership_subscriptions_creator_status',
          'ix_membership_subscriptions_updated_at',
          'ux_membership_subscriptions_trial_per_subscriber_creator',
          'ix_membership_subscriptions_trial_end',
          'ix_membership_plans_owner_status_updated',
          'ix_membership_plans_status_visibility_updated',
          'ix_membership_plan_versions_created',
          'ix_membership_revenuecat_bindings_plan_version',
          'ux_membership_plan_change_attempts_idempotency',
          'ux_membership_plan_change_attempts_pending_subscription',
          'ix_membership_plan_change_attempts_order_status',
          'ix_membership_plan_change_attempts_expiry',
          'ux_membership_scheduled_plan_changes_idempotency',
          'ux_membership_scheduled_plan_changes_pending_subscription',
          'ix_membership_scheduled_plan_changes_effective'
        )) <> 17 THEN
    RAISE EXCEPTION 'W07 secondary index set is incomplete';
  END IF;

  IF (SELECT COUNT(*) FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgname IN (
          'membership_plan_versions_immutable_update',
          'membership_plan_versions_immutable_delete',
          'membership_plans_owner_immutable_update',
          'membership_plans_current_version_forward_only',
          'membership_revenuecat_bindings_immutable_update',
          'membership_revenuecat_bindings_immutable_delete',
          'membership_subscriptions_trial_window_immutable',
          'membership_subscriptions_trial_conversion_write_once'
        )) <> 8 THEN
    RAISE EXCEPTION 'W07 immutable/lifecycle trigger set is incomplete';
  END IF;

  IF (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid = 'membership_plan_versions'::regclass AND contype = 'f') <> 1
     OR (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid = 'membership_revenuecat_product_bindings'::regclass AND contype = 'f') <> 1
     OR EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE contype = 'f'
         AND conrelid IN (
           'membership_subscriptions'::regclass,
           'membership_plans'::regclass,
           'membership_subscription_plan_change_attempts'::regclass,
           'membership_subscription_scheduled_plan_changes'::regclass
         )
     ) THEN
    RAISE EXCEPTION 'Only the two source-defined plan-version foreign keys are allowed';
  END IF;

  IF (SELECT COUNT(*) FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'membership_subscriptions'
        AND indexdef ILIKE 'CREATE UNIQUE INDEX%') <> 2 THEN
    RAISE EXCEPTION 'Subscription uniqueness must remain primary key plus one-trial-per-creator only';
  END IF;

  INSERT INTO membership_plans
    (plan_id, owner_type, owner_id, current_version, status, visibility, version, created_at, updated_at)
  VALUES
    ('w07-schema-fixture-plan', 'CREATOR', 'w07-schema-fixture-creator', 1,
     'ACTIVE', 'PUBLIC', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

  INSERT INTO membership_plan_versions
    (plan_id, plan_version, name, tier, billing_interval, price_minor, currency,
     benefits_json, created_at)
  VALUES
    ('w07-schema-fixture-plan', 1, 'Basic', 'basic', 'MONTHLY', 500, 'USD',
     '[]', '2026-01-01T00:00:00Z'),
    ('w07-schema-fixture-plan', 2, 'Plus', 'plus', 'YEARLY', 5000, 'USD',
     '["priority"]', '2026-01-02T00:00:00Z');

  BEGIN
    UPDATE membership_plans SET current_version = 1
    WHERE plan_id = 'w07-schema-fixture-plan';
    RAISE EXCEPTION 'Expected current_version non-forward update to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE membership_plans SET owner_id = 'different-owner'
    WHERE plan_id = 'w07-schema-fixture-plan';
    RAISE EXCEPTION 'Expected immutable plan owner update to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE membership_plans SET current_version = 3
    WHERE plan_id = 'w07-schema-fixture-plan';
    RAISE EXCEPTION 'Expected current_version missing target to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE membership_plans SET current_version = 2, version = version + 1
  WHERE plan_id = 'w07-schema-fixture-plan';
  IF (SELECT current_version FROM membership_plans
      WHERE plan_id = 'w07-schema-fixture-plan') <> 2 THEN
    RAISE EXCEPTION 'Forward current_version transition to existing plan version failed';
  END IF;

  BEGIN
    UPDATE membership_plan_versions SET name = 'Mutable'
    WHERE plan_id = 'w07-schema-fixture-plan' AND plan_version = 1;
    RAISE EXCEPTION 'Expected immutable plan-version update to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    DELETE FROM membership_plan_versions
    WHERE plan_id = 'w07-schema-fixture-plan' AND plan_version = 1;
    RAISE EXCEPTION 'Expected immutable plan-version delete to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO membership_plan_versions
      (plan_id, plan_version, name, tier, billing_interval, price_minor, currency, benefits_json, created_at)
    VALUES
      ('w07-schema-fixture-plan', 3, 'Invalid', 'Not Lowercase', 'MONTHLY', 100, 'USD', '[]', now());
    RAISE EXCEPTION 'Expected invalid tier to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO membership_plan_versions
      (plan_id, plan_version, name, tier, billing_interval, price_minor, currency, benefits_json, created_at)
    VALUES
      ('w07-schema-fixture-plan', 3, 'Invalid', 'bad', 'MONTHLY', 100, 'US', '[]', now());
    RAISE EXCEPTION 'Expected invalid currency to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO membership_plan_versions
      (plan_id, plan_version, name, tier, billing_interval, price_minor, currency, benefits_json, created_at)
    VALUES
      ('w07-schema-fixture-plan', 3, 'Invalid', 'bad', 'MONTHLY', 100, 'USD', '{}', now());
    RAISE EXCEPTION 'Expected non-array benefits JSON to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO membership_plan_versions
      (plan_id, plan_version, name, tier, billing_interval, price_minor, currency, benefits_json, created_at, trial_period_days)
    VALUES
      ('w07-schema-fixture-plan', 3, 'Invalid', 'bad', 'MONTHLY', 100, 'USD', '[]', now(), 31);
    RAISE EXCEPTION 'Expected trial_period_days > 30 to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO membership_revenuecat_product_bindings
    (revenuecat_app_id, store, product_id, plan_id, plan_version, created_at)
  VALUES
    ('w07-fixture-app', 'PLAY_STORE', 'w07-fixture-product',
     'w07-schema-fixture-plan', 2, '2026-01-01T00:00:00Z');

  IF (SELECT status FROM membership_revenuecat_product_bindings
      WHERE revenuecat_app_id = 'w07-fixture-app'
        AND store = 'PLAY_STORE' AND product_id = 'w07-fixture-product') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'RevenueCat binding default status must be ACTIVE';
  END IF;

  BEGIN
    UPDATE membership_revenuecat_product_bindings SET product_id = 'changed'
    WHERE revenuecat_app_id = 'w07-fixture-app'
      AND store = 'PLAY_STORE' AND product_id = 'w07-fixture-product';
    RAISE EXCEPTION 'Expected RevenueCat binding identity update to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE membership_revenuecat_product_bindings
  SET status = 'RETIRED', retired_at = '2026-01-03T00:00:00Z'
  WHERE revenuecat_app_id = 'w07-fixture-app'
    AND store = 'PLAY_STORE' AND product_id = 'w07-fixture-product';

  BEGIN
    UPDATE membership_revenuecat_product_bindings
    SET retired_at = '2026-01-04T00:00:00Z'
    WHERE revenuecat_app_id = 'w07-fixture-app'
      AND store = 'PLAY_STORE' AND product_id = 'w07-fixture-product';
    RAISE EXCEPTION 'Expected RevenueCat retirement rewrite to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    DELETE FROM membership_revenuecat_product_bindings
    WHERE revenuecat_app_id = 'w07-fixture-app'
      AND store = 'PLAY_STORE' AND product_id = 'w07-fixture-product';
    RAISE EXCEPTION 'Expected RevenueCat binding delete to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO membership_subscriptions
    (subscription_id, subscriber_id, plan_id, plan_version, creator_id, status,
     started_at, current_period_start, current_period_end, created_at, updated_at,
     trial_started_at, trial_ends_at)
  VALUES
    ('w07-schema-fixture-trial', 'w07-fixture-subscriber', 'w07-schema-fixture-plan', 2,
     'w07-schema-fixture-creator', 'TRIALING',
     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z',
     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
     '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');

  BEGIN
    INSERT INTO membership_subscriptions
      (subscription_id, subscriber_id, plan_id, plan_version, creator_id, status,
       started_at, current_period_start, current_period_end, created_at, updated_at,
       trial_started_at, trial_ends_at)
    VALUES
      ('w07-schema-fixture-trial-duplicate', 'w07-fixture-subscriber',
       'w07-schema-fixture-plan', 2, 'w07-schema-fixture-creator', 'TRIALING',
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z',
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
       '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');
    RAISE EXCEPTION 'Expected one lifetime trial per subscriber/creator to be enforced';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE membership_subscriptions SET trial_ends_at = '2026-01-10T00:00:00Z'
    WHERE subscription_id = 'w07-schema-fixture-trial';
    RAISE EXCEPTION 'Expected trial window rewrite to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE membership_subscriptions SET trial_converted_at = '2026-01-08T00:00:00Z'
  WHERE subscription_id = 'w07-schema-fixture-trial';

  BEGIN
    UPDATE membership_subscriptions SET trial_converted_at = '2026-01-09T00:00:00Z'
    WHERE subscription_id = 'w07-schema-fixture-trial';
    RAISE EXCEPTION 'Expected trial conversion rewrite to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO membership_subscriptions
    (subscription_id, subscriber_id, plan_id, plan_version, creator_id, status,
     started_at, current_period_start, current_period_end, created_at, updated_at)
  VALUES
    ('w07-schema-fixture-active-a', 'w07-fixture-active-subscriber',
     'w07-schema-fixture-plan', 2, 'w07-schema-fixture-creator', 'ACTIVE',
     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    ('w07-schema-fixture-active-b', 'w07-fixture-active-subscriber',
     'w07-schema-fixture-plan', 2, 'w07-schema-fixture-creator', 'ACTIVE',
     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

  INSERT INTO membership_subscription_plan_change_attempts
    (attempt_id, subscriber_id, subscription_id, expected_subscription_version,
     expected_plan_id, expected_plan_version, target_plan_id, target_plan_version,
     current_period_start, current_period_end, idempotency_key_hash, order_id,
     status, expires_at, created_at, updated_at)
  VALUES
    ('w07-schema-fixture-attempt', 'w07-fixture-subscriber', 'w07-opaque-subscription',
     1, 'w07-old-plan', 1, 'w07-new-plan', 2,
     '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
     'sha256-fixture-key-a', 'opaque-d1-04-order-reference',
     'PENDING_PAYMENT', '2026-01-10T00:00:00Z',
     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

  BEGIN
    INSERT INTO membership_subscription_plan_change_attempts
      (attempt_id, subscriber_id, subscription_id, expected_subscription_version,
       expected_plan_id, expected_plan_version, target_plan_id, target_plan_version,
       current_period_start, current_period_end, idempotency_key_hash, status,
       expires_at, created_at, updated_at)
    VALUES
      ('w07-schema-fixture-attempt-duplicate', 'w07-fixture-subscriber', 'w07-opaque-subscription',
       1, 'w07-old-plan', 1, 'w07-new-plan', 2,
       '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
       'sha256-fixture-key-b', 'PENDING_PAYMENT',
       '2026-01-10T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    RAISE EXCEPTION 'Expected one pending paid plan-change attempt per subscription';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO membership_subscription_plan_change_attempts
      (attempt_id, subscriber_id, subscription_id, expected_subscription_version,
       expected_plan_id, expected_plan_version, target_plan_id, target_plan_version,
       current_period_start, current_period_end, idempotency_key_hash, status,
       expires_at, created_at, updated_at)
    VALUES
      ('w07-schema-fixture-attempt-invalid', 'w07-fixture-subscriber', 'w07-other-subscription',
       1, 'w07-old-plan', 1, 'w07-new-plan', 2,
       '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
       'sha256-fixture-key-invalid', 'NOT_A_STATUS',
       '2026-01-10T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    RAISE EXCEPTION 'Expected invalid paid plan-change status to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE membership_subscription_plan_change_attempts
  SET status = 'APPLIED', applied_at = '2026-01-02T00:00:00Z',
      applied_subscription_version = 2
  WHERE attempt_id = 'w07-schema-fixture-attempt';
  IF (SELECT status FROM membership_subscription_plan_change_attempts
      WHERE attempt_id = 'w07-schema-fixture-attempt') <> 'APPLIED' THEN
    RAISE EXCEPTION 'Paid plan-change attempt valid APPLIED transition failed';
  END IF;

  BEGIN
    INSERT INTO membership_subscription_plan_change_attempts
      (attempt_id, subscriber_id, subscription_id, expected_subscription_version,
       expected_plan_id, expected_plan_version, target_plan_id, target_plan_version,
       current_period_start, current_period_end, idempotency_key_hash, status,
       expires_at, created_at, updated_at, applied_subscription_version)
    VALUES
      ('w07-schema-fixture-attempt-invalid-applied', 'w07-fixture-subscriber',
       'w07-another-subscription', 1, 'w07-old-plan', 1, 'w07-new-plan', 2,
       '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
       'sha256-fixture-key-c', 'APPLIED', '2026-01-10T00:00:00Z',
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 2);
    RAISE EXCEPTION 'Expected APPLIED attempt to require applied_at and applied version together';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO membership_subscription_scheduled_plan_changes
    (change_id, subscriber_id, subscription_id, expected_subscription_version,
     expected_plan_id, expected_plan_version, target_plan_id, target_plan_version,
     effective_at, idempotency_key_hash, status, created_at, updated_at)
  VALUES
    ('w07-schema-fixture-schedule', 'w07-fixture-subscriber', 'w07-scheduled-subscription',
     1, 'w07-old-plan', 1, 'w07-new-plan', 2,
     '2026-02-01T00:00:00Z', 'sha256-fixture-scheduled-key-a',
     'SCHEDULED', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

  IF (SELECT change_type FROM membership_subscription_scheduled_plan_changes
      WHERE change_id = 'w07-schema-fixture-schedule') <> 'DOWNGRADE' THEN
    RAISE EXCEPTION 'Scheduled plan change default discriminator must be DOWNGRADE';
  END IF;

  BEGIN
    INSERT INTO membership_subscription_scheduled_plan_changes
      (change_id, subscriber_id, subscription_id, expected_subscription_version,
       expected_plan_id, expected_plan_version, target_plan_id, target_plan_version,
       effective_at, idempotency_key_hash, status, created_at, updated_at)
    VALUES
      ('w07-schema-fixture-schedule-duplicate', 'w07-fixture-subscriber',
       'w07-scheduled-subscription', 1, 'w07-old-plan', 1, 'w07-new-plan', 2,
       '2026-02-01T00:00:00Z', 'sha256-fixture-scheduled-key-b',
       'SCHEDULED', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    RAISE EXCEPTION 'Expected one scheduled change per subscription';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO membership_subscription_scheduled_plan_changes
      (change_id, subscriber_id, subscription_id, expected_subscription_version,
       expected_plan_id, expected_plan_version, target_plan_id, target_plan_version,
       effective_at, idempotency_key_hash, status, created_at, updated_at, change_type)
    VALUES
      ('w07-schema-fixture-schedule-invalid', 'w07-fixture-subscriber',
       'w07-other-scheduled-subscription', 1, 'w07-old-plan', 1, 'w07-new-plan', 2,
       '2026-02-01T00:00:00Z', 'sha256-fixture-scheduled-key-invalid',
       'SCHEDULED', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'UPGRADE');
    RAISE EXCEPTION 'Expected invalid scheduled change type to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE membership_subscription_scheduled_plan_changes
  SET change_type = 'BILLING_INTERVAL_CHANGE'
  WHERE change_id = 'w07-schema-fixture-schedule';
  IF (SELECT change_type FROM membership_subscription_scheduled_plan_changes
      WHERE change_id = 'w07-schema-fixture-schedule') <> 'BILLING_INTERVAL_CHANGE' THEN
    RAISE EXCEPTION 'Scheduled change type discriminator failed';
  END IF;
END;
$w07_membership_schema_verify$;

ROLLBACK;

SELECT jsonb_build_object(
  'status', 'W07_D1_01_MEMBERSHIP_POSTGRES_SCHEMA_PASS',
  'postgresMajor', 18,
  'tablesVerified', 6,
  'secondaryIndexesVerified', 17,
  'triggersVerified', 8,
  'checks', jsonb_build_array(
    'exact Subscription 17-column contract',
    'TIMESTAMPTZ timestamp mapping',
    'source-defined plan and RevenueCat foreign keys only',
    'no speculative active-subscription uniqueness',
    'immutable plan versions and forward-only plan version',
    'RevenueCat ACTIVE-to-RETIRED-only update',
    'one-trial-per-subscriber/creator and write-once trial timestamps',
    'upgrade attempt idempotency and one-pending-per-subscription',
    'scheduled-change idempotency and one-pending-per-subscription',
    'DOWNGRADE/BILLING_INTERVAL_CHANGE discriminator',
    'opaque D1-04 order reference only',
    'all synthetic writes rolled back'
  ),
  'businessRowsAfterRollback', jsonb_build_object(
    'membership_subscriptions', (SELECT COUNT(*) FROM membership_subscriptions),
    'membership_plans', (SELECT COUNT(*) FROM membership_plans),
    'membership_plan_versions', (SELECT COUNT(*) FROM membership_plan_versions),
    'membership_revenuecat_product_bindings', (SELECT COUNT(*) FROM membership_revenuecat_product_bindings),
    'membership_subscription_plan_change_attempts', (SELECT COUNT(*) FROM membership_subscription_plan_change_attempts),
    'membership_subscription_scheduled_plan_changes', (SELECT COUNT(*) FROM membership_subscription_scheduled_plan_changes)
  ),
  'productionDatabaseTouched', false,
  'businessDataImported', false
) AS evidence;
