-- GENERATED FILE
-- Source authority: contracts/migration/AUTH-013-publication-journal.v1.json
-- Event authority: contracts/events/identity-account-state-changed.v1.json
-- W02 owns the durable publication journal; W06 owns audit-event persistence.
-- The journal is not an Account State authority and must never write D1-03.
-- Historical 0002_auth_013_account_state.sql targets Payload users and is not this table migration.
-- SQLite ISO timestamp TEXT columns are represented as TIMESTAMPTZ in PostgreSQL.
-- No event, user, or business rows are backfilled.
-- Generator: workers/W02-identity/scripts/neon/generate-auth013-publication-journal-postgres-migration.mjs
-- Do not hand-edit. Regenerate from the canonical contracts.

CREATE TABLE auth_013_publication_journal (
  journal_id TEXT NOT NULL CONSTRAINT auth_013_publication_journal_pkey PRIMARY KEY,
  event_id TEXT NOT NULL CONSTRAINT auth_013_publication_journal_event_id_uq UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type = 'identity.account_state_changed'),
  schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
  resource_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128),
  CONSTRAINT auth_013_publication_journal_resource_version_uq
    UNIQUE (resource_id, event_type, source_version)
);

CREATE INDEX auth_013_publication_journal_status_next_attempt_idx
  ON auth_013_publication_journal(status, next_attempt_at);
