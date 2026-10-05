-- W06 / D1-03 canonical immutable AuditEvent persistence.
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
