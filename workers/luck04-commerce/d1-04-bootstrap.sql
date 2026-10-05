-- LuckRead 1.1 D1-04 bootstrap: Commerce + Governance schema assembled from existing 1.0 migrations.
-- Apply once to the D1-04 target before data cutover.\n\nCREATE TABLE IF NOT EXISTS membership_subscriptions (
  subscription_id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  creator_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  cancel_at TEXT,
  entitlement_snapshot_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_subscriber_status_period
  ON membership_subscriptions (subscriber_id, status, current_period_end);

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_plan_version
  ON membership_subscriptions (plan_id, plan_version);

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_creator_status
  ON membership_subscriptions (creator_id, status);

CREATE INDEX IF NOT EXISTS ix_membership_subscriptions_updated_at
  ON membership_subscriptions (updated_at);
\n\n-- W06 / D1-03 canonical immutable AuditEvent persistence.
-- Source of truth: contracts/schemas/common/audit-event.json
-- Remote application is separately gated by w06-audit-event-migration.yml.

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  actor_json TEXT NOT NULL
    CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  action TEXT NOT NULL
    CHECK (
      length(action) BETWEEN 1 AND 128
      AND action GLOB '[a-z]*'
      AND action NOT GLOB '*[^a-z0-9_.]*'
    ),
  target_type TEXT NOT NULL
    CHECK (length(target_type) >= 1),
  target_id TEXT NOT NULL,
  before_json TEXT NOT NULL
    CHECK (json_valid(before_json) AND json_type(before_json) = 'object'),
  after_json TEXT NOT NULL
    CHECK (json_valid(after_json) AND json_type(after_json) = 'object'),
  reason TEXT
    CHECK (reason IS NULL OR length(reason) <= 2048),
  ip TEXT,
  user_agent TEXT
    CHECK (user_agent IS NULL OR length(user_agent) <= 1024),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_action_occurred_at
  ON audit_events(action, occurred_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_target_occurred_at
  ON audit_events(target_type, target_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS audit_events_immutable_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_immutable_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_IMMUTABLE');
END;
\n\nCREATE TABLE IF NOT EXISTS moderation_cases (
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
\n\nCREATE TABLE IF NOT EXISTS moderation_reports (
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
