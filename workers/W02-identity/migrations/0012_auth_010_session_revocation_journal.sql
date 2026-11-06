-- AUTH-010 session revocation audit outbox.
-- W02 remains the D1-01 session authority; this journal stores only the
-- immutable event intent required to publish to the existing W02->W06 queue.
-- No second Session table or new Queue/Worker/Service Binding is introduced.

CREATE TABLE auth_010_session_revocation_journal (
  journal_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type = 'user.session.revoked'),
  schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),
  resource_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version = 1),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128),
  UNIQUE (resource_id, event_type)
);

CREATE INDEX auth_010_session_revocation_journal_status_next_attempt_idx
  ON auth_010_session_revocation_journal (status, next_attempt_at);
