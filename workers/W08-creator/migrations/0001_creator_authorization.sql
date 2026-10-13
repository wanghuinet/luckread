-- W08 / D1-01 owns creator applications and creator identity facts.
-- RoleAssignment remains W02-owned.
CREATE TABLE IF NOT EXISTS creator_applications (
  application_id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  creator_type TEXT NOT NULL CHECK (creator_type IN ('PERSONAL','WRITER','VIDEO_CREATOR','DEVELOPER','ARTIST','OTHER')),
  statement TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  grant_state TEXT NOT NULL CHECK (grant_state IN ('NOT_REQUESTED','PENDING','GRANTED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  application_idempotency_key TEXT NOT NULL,
  decision_idempotency_key TEXT,
  decided_by TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE(user_id, application_idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS creator_applications_one_pending_per_user
  ON creator_applications(user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS creator_applications_status_created_idx
  ON creator_applications(status, created_at);

CREATE TABLE IF NOT EXISTS creators (
  creator_id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  application_id TEXT NOT NULL UNIQUE,
  creator_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_ROLE_GRANT','ACTIVE','REVOKED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS creators_status_idx ON creators(status);

CREATE TABLE IF NOT EXISTS creator_authorization_audit (
  audit_id TEXT NOT NULL PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'CREATOR_APPLICATION_SUBMITTED',
    'CREATOR_APPLICATION_APPROVED',
    'CREATOR_APPLICATION_REJECTED',
    'CREATOR_ROLE_GRANTED'
  )),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('creator_application','creator','role_assignment')),
  resource_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  idempotency_key TEXT,
  correlation_id TEXT,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS creator_authorization_audit_subject_time_idx
  ON creator_authorization_audit(subject_id, occurred_at);
CREATE INDEX IF NOT EXISTS creator_authorization_audit_resource_time_idx
  ON creator_authorization_audit(resource_type, resource_id, occurred_at);
