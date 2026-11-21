-- GENERATED FILE
-- Source authority: workers/W02-identity/migrations/0008_auth_007_mfa_publication_journal.sql
-- Migration contract: contracts/migration/AUTH-007-mfa-publication-journal.v1.json
-- Event contract: contracts/events/AUTH-007-mfa-audit-binding.v1.json
-- W02/D1-01 owns the durable MFA audit publication intent; W06/D1-03 owns canonical AuditEvent persistence.
-- This journal is not an MFA factor authority or the final audit store.
-- Delivery uses only the existing AUTH013_QUEUE / luckread-auth013-account-state transport.
-- SQLite ISO-8601 timestamp TEXT values are represented as PostgreSQL TIMESTAMPTZ.
-- Payload remains TEXT; PostgreSQL JSONB is used only to require a valid JSON object.
-- No users, factors, secrets, TOTP codes, recovery codes, sessions or audit events are imported.
-- AUTH-007 remains CONTRACTED_NOT_VERIFIED / NOT_GREEN; this is not production deployment or rollout admission.
-- Generator: workers/W02-identity/scripts/neon/generate-auth007-mfa-publication-journal-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the canonical migration and contracts.

CREATE TABLE auth_007_mfa_publication_journal (
  journal_id TEXT NOT NULL CONSTRAINT auth_007_mfa_publication_journal_pkey PRIMARY KEY,
  event_id TEXT NOT NULL CONSTRAINT auth_007_mfa_publication_journal_event_id_uq UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'auth.mfa.enrollment_started',
    'auth.mfa.enrollment_verified',
    'auth.mfa.enrollment_failed',
    'auth.mfa.challenge_succeeded',
    'auth.mfa.challenge_failed',
    'auth.mfa.factor_disabled',
    'auth.mfa.recovery_codes_rotated',
    'auth.mfa.recovery_code_consumed',
    'auth.mfa.locked',
    'auth.mfa.replay_rejected'
  )),
  schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
  resource_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  idempotency_key TEXT NOT NULL CONSTRAINT auth_007_mfa_publication_journal_idempotency_key_uq UNIQUE,
  payload TEXT NOT NULL CHECK (jsonb_typeof(payload::jsonb) = 'object'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128)
);

CREATE INDEX auth_007_mfa_publication_journal_status_next_attempt_idx
  ON auth_007_mfa_publication_journal(status, next_attempt_at);
