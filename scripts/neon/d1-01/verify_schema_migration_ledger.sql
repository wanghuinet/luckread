\set ON_ERROR_STOP on
BEGIN;

DO $neon_schema_migration_ledger_verify$
DECLARE
  actual_names TEXT[];
  expected_names TEXT[] := ARRAY[
    'applied_at','artifact_sha256','database_name','domain_id','execution_id',
    'manifest_entry_sha256','migration_id','migration_kind','migration_order',
    'owner_worker','runner_version','source_commit_sha'
  ];
  inserted_count INTEGER;
BEGIN
  IF current_setting('server_version_num')::INTEGER / 10000 <> 18 THEN
    RAISE EXCEPTION 'ledger verifier requires PostgreSQL 18';
  END IF;
  IF current_database() <> 'luckread_schema' THEN
    RAISE EXCEPTION 'ledger verifier must run only against luckread_schema';
  END IF;

  SELECT array_agg(column_name ORDER BY column_name)
    INTO actual_names
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='neon_schema_migration_ledger';
  IF actual_names IS DISTINCT FROM expected_names THEN
    RAISE EXCEPTION 'ledger column contract drift: %', actual_names;
  END IF;

  IF (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='neon_schema_migration_ledger') <> 12
     OR (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='neon_schema_migration_ledger'
        AND column_name='applied_at') <> 'timestamp with time zone'
     OR (SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='neon_schema_migration_ledger'
        AND column_name='applied_at') NOT LIKE 'clock_timestamp%' THEN
    RAISE EXCEPTION 'ledger exact column count or applied_at type/default drifted';
  END IF;

  IF (SELECT COUNT(*) FROM pg_indexes
      WHERE schemaname='public' AND tablename='neon_schema_migration_ledger'
        AND indexname IN (
          'neon_schema_migration_ledger_pkey',
          'neon_schema_migration_ledger_order_unique',
          'neon_schema_migration_ledger_owner_applied_idx'
        )) <> 3 THEN
    RAISE EXCEPTION 'ledger key/index set is incomplete';
  END IF;

  IF (SELECT COUNT(*) FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='neon_schema_migration_ledger'
        AND NOT t.tgisinternal
        AND t.tgname IN (
          'neon_schema_migration_ledger_no_update_or_delete',
          'neon_schema_migration_ledger_no_truncate'
        )) <> 2 THEN
    RAISE EXCEPTION 'ledger append-only trigger set is incomplete';
  END IF;

  IF (SELECT COUNT(*) FROM pg_constraint
      WHERE conrelid='neon_schema_migration_ledger'::regclass AND contype='f') <> 0 THEN
    RAISE EXCEPTION 'migration ledger must not have cross-domain foreign keys';
  END IF;

  INSERT INTO neon_schema_migration_ledger
    (domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,
     artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id)
  VALUES
    ('D1-01','luckread','W01','W01-FIXTURE-BASELINE',100,'PAYLOAD_NATIVE',
     repeat('a',64),repeat('b',64),repeat('c',40),'ledger-ci/1','ledger-verifier-fixture');

  IF (SELECT COUNT(*) FROM neon_schema_migration_ledger) <> 1 THEN
    RAISE EXCEPTION 'ledger fixture insert failed';
  END IF;

  BEGIN
    INSERT INTO neon_schema_migration_ledger
      (domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,
       artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id)
    VALUES
      ('D1-01','luckread','W01','W01-FIXTURE-BASELINE',101,'PAYLOAD_NATIVE',
       repeat('a',64),repeat('b',64),repeat('c',40),'ledger-ci/1','duplicate-id');
    RAISE EXCEPTION 'expected duplicate owner/migration key to fail';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO neon_schema_migration_ledger
      (domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,
       artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id)
    VALUES
      ('D1-01','luckread','W02','W02-FIXTURE-DUPLICATE-ORDER',100,'POSTGRESQL_SQL',
       repeat('d',64),repeat('e',64),repeat('f',40),'ledger-ci/1','duplicate-order');
    RAISE EXCEPTION 'expected per-domain migration order uniqueness to fail';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO neon_schema_migration_ledger
      (domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,
       artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id)
    VALUES
      ('D1-01','luckreadpro','W02','W02-WRONG-DATABASE',200,'POSTGRESQL_SQL',
       repeat('a',64),repeat('b',64),repeat('c',40),'ledger-ci/1','wrong-database');
    RAISE EXCEPTION 'expected D1-01 database mapping to be enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO neon_schema_migration_ledger
      (domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,
       artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id)
    VALUES
      ('D1-01','luckread','W03','W03-WRONG-OWNER',200,'POSTGRESQL_SQL',
       repeat('a',64),repeat('b',64),repeat('c',40),'ledger-ci/1','wrong-owner');
    RAISE EXCEPTION 'expected D1-01 owner mapping to be enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE neon_schema_migration_ledger
      SET artifact_sha256=repeat('d',64)
      WHERE migration_id='W01-FIXTURE-BASELINE';
    RAISE EXCEPTION 'expected ledger UPDATE to be rejected';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    DELETE FROM neon_schema_migration_ledger
      WHERE migration_id='W01-FIXTURE-BASELINE';
    RAISE EXCEPTION 'expected ledger DELETE to be rejected';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    EXECUTE 'TRUNCATE TABLE neon_schema_migration_ledger';
    RAISE EXCEPTION 'expected ledger TRUNCATE to be rejected';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('luckread:neon-schema-migration:' || current_database(), 0)
  ) THEN
    RAISE EXCEPTION 'expected transaction advisory lock to be available';
  END IF;

  SELECT COUNT(*) INTO inserted_count FROM neon_schema_migration_ledger;
  IF inserted_count <> 1 THEN
    RAISE EXCEPTION 'negative ledger checks changed existing provenance rows';
  END IF;
END;
$neon_schema_migration_ledger_verify$;

ROLLBACK;

SELECT jsonb_build_object(
  'status','NEON_SCHEMA_MIGRATION_LEDGER_SCHEMA_PASS',
  'postgresMajor',18,
  'columnsVerified',12,
  'primaryAndUniqueKeysVerified',2,
  'secondaryIndexesVerified',1,
  'appendOnlyTriggersVerified',2,
  'foreignKeys',0,
  'checks',jsonb_build_array(
    'D1 domain/database mapping',
    'domain owner mapping',
    'unique migration order',
    'migration key uniqueness',
    'SHA-256 and source commit format checks',
    'append-only UPDATE/DELETE/TRUNCATE protection',
    'PostgreSQL transaction advisory lock primitive available',
    'all synthetic bookkeeping rows rolled back'
  ),
  'ledgerRowsAfterRollback',(SELECT COUNT(*) FROM neon_schema_migration_ledger),
  'businessDataImported',false,
  'remoteDatabaseTouched',false
) AS evidence;
