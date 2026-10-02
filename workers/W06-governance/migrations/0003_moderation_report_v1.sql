CREATE TABLE IF NOT EXISTS moderation_reports (
  report_id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('content','comment','creator','media','profile')),
  target_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  description TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
  policy_version TEXT NOT NULL,
  dedup_bucket TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(actor_user_id, target_type, target_id, reason_code, dedup_bucket)
);

CREATE INDEX IF NOT EXISTS ix_moderation_reports_target_created
  ON moderation_reports(target_type, target_id, created_at);

CREATE INDEX IF NOT EXISTS ix_moderation_reports_actor_created
  ON moderation_reports(actor_user_id, created_at);

CREATE TABLE IF NOT EXISTS moderation_report_idempotency (
  id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  report_id TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(actor_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_moderation_report_idem_expiry
  ON moderation_report_idempotency(expires_at);
