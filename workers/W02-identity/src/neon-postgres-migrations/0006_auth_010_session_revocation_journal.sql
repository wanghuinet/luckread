-- GENERATED FILE
-- Source authority: contracts/migration/AUTH-010-session-revocation-journal.v1.json
-- Event authority: contracts/events/AUTH-010-session-revoked-binding.v1.json
-- W02 owns the durable session-revocation outbox; W06 owns AuditEvent persistence.
-- Better Auth "session" remains the sole session-state authority. This is not a Session table.
-- No production D1 migration/deployment, user data, session data, or audit event is included.
-- SQLite ISO-8601 timestamp TEXT fields are represented as PostgreSQL TIMESTAMPTZ.
-- Payload remains TEXT; PostgreSQL JSONB is used only to enforce valid JSON object shape.
-- Generator: workers/W02-identity/scripts/neon/generate-auth010-session-revocation-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the canonical contracts.

CREATE TABLE auth_010_session_revocation_journal (
  journal_id TEXT NOT NULL CONSTRAINT auth_010_session_revocation_journal_pkey PRIMARY KEY,
  event_id TEXT NOT NULL CONSTRAINT auth_010_session_revocation_journal_event_id_uq UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type = 'user.session.revoked'),
  schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
  resource_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version = 1),
  idempotency_key TEXT NOT NULL CONSTRAINT auth_010_session_revocation_journal_idempotency_key_uq UNIQUE,
  payload TEXT NOT NULL CHECK (jsonb_typeof(payload::jsonb) = 'object'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128),
  CONSTRAINT auth_010_session_revocation_journal_resource_event_uq UNIQUE (resource_id, event_type)
);

CREATE INDEX auth_010_session_revocation_journal_status_next_attempt_idx
  ON auth_010_session_revocation_journal(status, next_attempt_at);
