-- AUTH-007 W02 durable MFA audit publication outbox.
-- Uses existing D1-01, AUTH013_QUEUE and W06 D1-03 AuditEvent authority.
-- It adds no Worker, database, Queue, or Service Binding.

CREATE TABLE auth_007_mfa_publication_journal (
  journal_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
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
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128)
);

CREATE INDEX auth_007_mfa_publication_journal_status_next_attempt_idx
  ON auth_007_mfa_publication_journal (status, next_attempt_at);
