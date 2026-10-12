-- W08 / D1-01 owns creator applications, creator identity, organization/IP
-- scope references and scope membership facts. RoleAssignment remains W02-owned.
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

CREATE TABLE IF NOT EXISTS creator_scopes (
  scope_id TEXT NOT NULL PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('organization','ip')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  verification_state TEXT NOT NULL CHECK (verification_state IN ('PENDING','VERIFIED','REJECTED')),
  created_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(created_by, idempotency_key)
);
CREATE INDEX IF NOT EXISTS creator_scopes_type_status_idx
  ON creator_scopes(scope_type, status);

CREATE TABLE IF NOT EXISTS creator_scope_appointments (
  appointment_id TEXT NOT NULL PRIMARY KEY,
  scope_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope_role TEXT NOT NULL CHECK (scope_role IN ('IP_PRINCIPAL','ORG_LEAD','ORG_EDITOR')),
  role_id TEXT NOT NULL CHECK (role_id IN ('ip_principal','mcn_admin','mcn_editor')),
  status TEXT NOT NULL CHECK (status IN ('PENDING_ROLE_GRANT','ACTIVE')),
  grant_ref TEXT NOT NULL UNIQUE,
  appointed_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_id, user_id),
  UNIQUE(appointed_by, idempotency_key),
  FOREIGN KEY(scope_id) REFERENCES creator_scopes(scope_id)
);
CREATE INDEX IF NOT EXISTS creator_scope_appointments_user_idx
  ON creator_scope_appointments(user_id, status);
