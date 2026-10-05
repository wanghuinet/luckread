CREATE TABLE IF NOT EXISTS moderation_cases (
  case_id TEXT NOT NULL PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_version INTEGER,
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_reviewer_id TEXT,
  current_decision_id TEXT,
  evidence_bundle_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_cases_case_id
  ON moderation_cases(case_id);
CREATE INDEX IF NOT EXISTS ix_moderation_cases_queue
  ON moderation_cases(state, priority DESC, created_at ASC, case_id ASC);
CREATE INDEX IF NOT EXISTS ix_moderation_cases_reviewer_state
  ON moderation_cases(assigned_reviewer_id, state, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS moderation_decisions (
  decision_id TEXT NOT NULL PRIMARY KEY,
  case_id TEXT NOT NULL,
  case_version INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_version INTEGER,
  policy_version TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  scope TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  expires_at TEXT,
  source_kind TEXT NOT NULL,
  reviewer_id TEXT,
  reviewer_layer TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(case_id, case_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_decisions_case_version
  ON moderation_decisions(case_id, case_version);
CREATE INDEX IF NOT EXISTS ix_moderation_decisions_case_created
  ON moderation_decisions(case_id, created_at);
CREATE INDEX IF NOT EXISTS ix_moderation_decisions_policy
  ON moderation_decisions(policy_version, created_at);

CREATE TABLE IF NOT EXISTS moderation_decision_idempotency (
  id TEXT NOT NULL PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(reviewer_id, case_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_moderation_idem_expiry
  ON moderation_decision_idempotency(expires_at);

CREATE TABLE IF NOT EXISTS moderation_txn_guard (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  successful INTEGER NOT NULL CHECK (successful = 1)
);

CREATE TABLE IF NOT EXISTS moderation_enforcement_outbox (
  outbox_id TEXT NOT NULL PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type = 'content'),
  target_id TEXT NOT NULL,
  target_version INTEGER NOT NULL CHECK (target_version >= 1),
  outcome TEXT NOT NULL CHECK (outcome IN ('APPROVED','REJECTED')),
  policy_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','DELIVERED','RETRY')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_moderation_enforcement_outbox_ready
  ON moderation_enforcement_outbox(status, next_attempt_at);
