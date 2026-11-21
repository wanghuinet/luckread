-- AUTH-007 durable receipts for MFA operations observed by Better Auth hooks.
-- These receipts are W02/D1-01 owned and never contain factors, codes, cookies,
-- passwords, session credentials, or request bodies. They make incomplete audit
-- outcomes visible and let the existing W02 Cron recover outbox write failures.

CREATE TABLE auth_007_mfa_operation_receipts (
  receipt_id TEXT PRIMARY KEY NOT NULL,
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
  started_at TEXT NOT NULL,
  completed_at TEXT,
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 128),
  causation_id TEXT NOT NULL CHECK (length(causation_id) BETWEEN 1 AND 128),
  event_plan TEXT CHECK (event_plan IS NULL OR (json_valid(event_plan) AND json_type(event_plan) = 'array')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_attempt_at TEXT,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128)
);

CREATE INDEX auth_007_mfa_operation_receipts_status_next_attempt_idx
  ON auth_007_mfa_operation_receipts (status, next_attempt_at, started_at);
