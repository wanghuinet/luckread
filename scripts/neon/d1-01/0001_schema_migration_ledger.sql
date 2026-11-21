-- Shared schema migration provenance ledger.
-- Install once in each approved Neon database via the reviewed migration executor.
-- No Worker owns this table; it is schema bookkeeping only, never business data.
-- It records successful schema migrations and is intentionally append-only.

BEGIN;

CREATE TABLE neon_schema_migration_ledger (
  domain_id TEXT NOT NULL
    CHECK (domain_id IN ('D1-01', 'D1-02', 'D1-03', 'D1-04', 'D1-05')),
  database_name TEXT NOT NULL,
  owner_worker TEXT NOT NULL,
  migration_id TEXT NOT NULL
    CHECK (migration_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$'),
  migration_order INTEGER NOT NULL
    CHECK (migration_order > 0),
  migration_kind TEXT NOT NULL
    CHECK (migration_kind IN ('PAYLOAD_NATIVE', 'GENERATED_POSTGRESQL_SQL', 'POSTGRESQL_SQL')),
  artifact_sha256 TEXT NOT NULL
    CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_entry_sha256 TEXT NOT NULL
    CHECK (manifest_entry_sha256 ~ '^[0-9a-f]{64}$'),
  source_commit_sha TEXT NOT NULL
    CHECK (source_commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  runner_version TEXT NOT NULL
    CHECK (length(runner_version) BETWEEN 1 AND 64),
  execution_id TEXT NOT NULL
    CHECK (length(execution_id) BETWEEN 1 AND 128),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT neon_schema_migration_ledger_pkey
    PRIMARY KEY (domain_id, owner_worker, migration_id),
  CONSTRAINT neon_schema_migration_ledger_order_unique
    UNIQUE (domain_id, migration_order),
  CONSTRAINT neon_schema_migration_ledger_domain_database_check CHECK (
    (domain_id = 'D1-01' AND database_name = 'luckread') OR
    (domain_id = 'D1-02' AND database_name = 'luckreadpro') OR
    (domain_id = 'D1-03' AND database_name = 'luckread_governance') OR
    (domain_id = 'D1-04' AND database_name = 'luckread_finance') OR
    (domain_id = 'D1-05' AND database_name = 'allluck')
  ),
  CONSTRAINT neon_schema_migration_ledger_domain_owner_check CHECK (
    (domain_id = 'D1-01' AND owner_worker IN ('W01', 'W02', 'W07', 'W08')) OR
    (domain_id = 'D1-02' AND owner_worker IN ('W03', 'W05')) OR
    (domain_id = 'D1-03' AND owner_worker IN ('W05', 'W06', 'W09')) OR
    (domain_id = 'D1-04' AND owner_worker = 'W07') OR
    (domain_id = 'D1-05' AND owner_worker = 'W11')
  )
);

CREATE INDEX neon_schema_migration_ledger_owner_applied_idx
  ON neon_schema_migration_ledger (domain_id, owner_worker, applied_at);

CREATE FUNCTION neon_schema_migration_ledger_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'neon_schema_migration_ledger is append-only; UPDATE, DELETE and TRUNCATE are forbidden'
    USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER neon_schema_migration_ledger_no_update_or_delete
BEFORE UPDATE OR DELETE ON neon_schema_migration_ledger
FOR EACH ROW EXECUTE FUNCTION neon_schema_migration_ledger_reject_mutation();

CREATE TRIGGER neon_schema_migration_ledger_no_truncate
BEFORE TRUNCATE ON neon_schema_migration_ledger
FOR EACH STATEMENT EXECUTE FUNCTION neon_schema_migration_ledger_reject_mutation();

COMMIT;
