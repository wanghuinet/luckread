-- AUTH-013 D1-01 durable publication journal
-- Authority: W02 / D1-01
-- Contract: contracts/migration/AUTH-013-publication-journal.v1.json
-- Scope: persistence boundary only; no Account State authority is duplicated.

CREATE TABLE auth_013_publication_journal (
  journal_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL
    CHECK (event_type = 'identity.account_state_changed'),
  schema_version TEXT NOT NULL
    CHECK (schema_version = '1.0'),
  resource_id TEXT NOT NULL,
  source_version INTEGER NOT NULL
    CHECK (source_version >= 1),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 1
    CHECK (attempt >= 1),
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  last_error_code TEXT
    CHECK (last_error_code IS NULL OR length(last_error_code) <= 128),
  UNIQUE (resource_id, event_type, source_version)
);

CREATE INDEX auth_013_publication_journal_status_next_attempt_idx
  ON auth_013_publication_journal (status, next_attempt_at);
