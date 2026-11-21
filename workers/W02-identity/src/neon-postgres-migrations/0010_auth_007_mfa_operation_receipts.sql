-- GENERATED FILE
-- Source authority: workers/W02-identity/migrations/0009_auth_007_mfa_operation_receipts.sql
-- Migration contract: contracts/migration/AUTH-007-mfa-operation-receipt.v1.json
-- Event contract: contracts/events/AUTH-007-mfa-audit-binding.v1.json
-- W02/D1-01 owns secret-free MFA operation receipts; W06/D1-03 owns canonical AuditEvent persistence.
-- Receipts preserve STARTED/READY/EMITTED/RESOLVED/UNKNOWN outcomes; they are not factor or audit authority.
-- READY receipts are reconciled by the existing W02 Cron and existing AUTH013_QUEUE only.
-- SQLite ISO-8601 timestamp TEXT values are represented as PostgreSQL TIMESTAMPTZ.
-- event_plan remains TEXT; PostgreSQL JSONB is used only to require a valid JSON array.
-- No users, factors, secrets, TOTP codes, recovery codes, sessions or event rows are imported.
-- AUTH-007 remains CONTRACTED_NOT_VERIFIED / NOT_GREEN; this is not production deployment or rollout admission.
-- Generator: workers/W02-identity/scripts/neon/generate-auth007-mfa-operation-receipts-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the canonical migration and contracts.

CREATE TABLE auth_007_mfa_operation_receipts (
  receipt_id TEXT NOT NULL CONSTRAINT auth_007_mfa_operation_receipts_pkey PRIMARY KEY,
  resource_id TEXT NOT NULL,
  operation_path TEXT NOT NULL CHECK (operation_path IN (
    '/two-factor/verify-totp',
    '/two-factor/verify-backup-code',
    '/two-factor/disable',
    '/two-factor/generate-backup-codes'
  )),
  is_challenge INTEGER NOT NULL CHECK (is_challenge IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'STARTED' CHECK (status IN (
    'STARTED',
    'READY',
    'EMITTED',
    'RESOLVED',
    'UNKNOWN'
  )),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 128),
  causation_id TEXT NOT NULL CHECK (length(causation_id) BETWEEN 1 AND 128),
  event_plan TEXT CHECK (event_plan IS NULL OR jsonb_typeof(event_plan::jsonb) = 'array'),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_attempt_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128)
);

CREATE INDEX auth_007_mfa_operation_receipts_status_next_attempt_idx
  ON auth_007_mfa_operation_receipts(status, next_attempt_at, started_at);
