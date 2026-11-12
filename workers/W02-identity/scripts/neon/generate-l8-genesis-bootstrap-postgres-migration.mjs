import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const workerRoot = resolve(scriptDir, '../..')
const sourcePath = resolve(workerRoot, 'migrations/0007_l8_genesis_bootstrap_audit.sql')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0011_l8_genesis_bootstrap_audit.sql')
const source = readFileSync(sourcePath, 'utf8')

const requiredSourceFragments = [
  'CREATE TABLE l8_genesis_bootstrap_audit',
  "bootstrap_key TEXT NOT NULL PRIMARY KEY CHECK (bootstrap_key = 'first-l8')",
  "operation TEXT NOT NULL CHECK (operation = 'INITIAL_L8_BOOTSTRAP')",
  'request_pr_number INTEGER NOT NULL CHECK (request_pr_number > 0)',
  'request_head_sha TEXT NOT NULL',
  'request_merge_sha TEXT NOT NULL',
  'target_user_id TEXT NOT NULL',
  'role_assignment_id TEXT NOT NULL UNIQUE',
  'nonce_sha256 TEXT NOT NULL UNIQUE',
  'approved_reviewers_json TEXT NOT NULL',
  'reviewer_permissions_json TEXT NOT NULL',
  'workflow_run_id TEXT NOT NULL',
  'valid_from TEXT NOT NULL',
  'valid_until TEXT NOT NULL',
  'created_at TEXT NOT NULL',
  'CHECK (valid_until > valid_from)',
]
for (const fragment of requiredSourceFragments) {
  if (!source.includes(fragment)) {
    throw new Error('Canonical D1 L8 bootstrap migration drifted: ' + fragment)
  }
}

const output = `-- GENERATED FILE
-- Source authority: workers/W02-identity/migrations/0007_l8_genesis_bootstrap_audit.sql
-- Change control: docs/change-control/CC-L8-GENESIS-BOOTSTRAP-OUT-OF-BAND-APPROVAL-2026-10-24.md
-- This additive PostgreSQL migration is deliberately outside the reviewed fourteen-entry D1-01 shared ledger.
-- Apply only after the L8-specific schema change is independently reviewed and released.
-- The singleton row is permanent: UPDATE, DELETE and TRUNCATE are rejected by database triggers.
-- No account, MFA factor, session or business data is imported.
-- Generator: workers/W02-identity/scripts/neon/generate-l8-genesis-bootstrap-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the canonical D1 source migration.

CREATE OR REPLACE FUNCTION l8_bootstrap_jsonb_object_key_count(input_value JSONB)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
AS $function$
DECLARE
  key_count INTEGER;
BEGIN
  IF jsonb_typeof(input_value) <> 'object' THEN RETURN 0; END IF;
  SELECT count(*)::INTEGER INTO key_count FROM jsonb_object_keys(input_value);
  RETURN key_count;
END;
$function$;

CREATE OR REPLACE FUNCTION l8_bootstrap_jsonb_array_item_count(input_value JSONB)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
AS $function$
BEGIN
  IF jsonb_typeof(input_value) <> 'array' THEN RETURN 0; END IF;
  RETURN jsonb_array_length(input_value);
END;
$function$;

CREATE TABLE l8_genesis_bootstrap_audit (
  bootstrap_key TEXT NOT NULL PRIMARY KEY CHECK (bootstrap_key = 'first-l8'),
  operation TEXT NOT NULL CHECK (operation = 'INITIAL_L8_BOOTSTRAP'),
  request_pr_number INTEGER NOT NULL CHECK (request_pr_number BETWEEN 1 AND 2147483647),
  request_head_sha TEXT NOT NULL CHECK (request_head_sha ~ '^[0-9a-f]{40}$'),
  request_merge_sha TEXT NOT NULL CHECK (request_merge_sha ~ '^[0-9a-f]{40}$'),
  target_user_id TEXT NOT NULL CHECK (length(target_user_id) BETWEEN 8 AND 128),
  role_assignment_id TEXT NOT NULL UNIQUE,
  nonce_sha256 TEXT NOT NULL UNIQUE CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  approved_reviewers_json JSONB NOT NULL CHECK (jsonb_typeof(approved_reviewers_json) = 'array' AND l8_bootstrap_jsonb_array_item_count(approved_reviewers_json) = 1),
  reviewer_permissions_json JSONB NOT NULL CHECK (jsonb_typeof(reviewer_permissions_json) = 'object' AND l8_bootstrap_jsonb_object_key_count(reviewer_permissions_json) = 1),
  workflow_run_id TEXT NOT NULL CHECK (workflow_run_id ~ '^[0-9]+$'),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (valid_until > valid_from)
);

CREATE INDEX l8_genesis_bootstrap_audit_target_idx
  ON l8_genesis_bootstrap_audit(target_user_id);

CREATE OR REPLACE FUNCTION reject_l8_genesis_bootstrap_audit_mutation_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'L8_BOOTSTRAP_AUDIT_IMMUTABLE';
END;
$function$;

CREATE TRIGGER l8_genesis_bootstrap_audit_no_update_or_delete
BEFORE UPDATE OR DELETE ON l8_genesis_bootstrap_audit
FOR EACH ROW EXECUTE FUNCTION reject_l8_genesis_bootstrap_audit_mutation_fn();

CREATE TRIGGER l8_genesis_bootstrap_audit_no_truncate
BEFORE TRUNCATE ON l8_genesis_bootstrap_audit
FOR EACH STATEMENT EXECUTE FUNCTION reject_l8_genesis_bootstrap_audit_mutation_fn();

`

writeFileSync(outputPath, output)
process.stdout.write('W02_L8_GENESIS_BOOTSTRAP_POSTGRES_MIGRATION_GENERATION_PASS\\n')
