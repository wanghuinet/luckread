-- GENERATED FILE
-- Source authority: contracts/entity/AUTHZ-role-assignment-authority.v1.json
-- Role vocabulary: contracts/authz/layers.json#x-layers[].roles
-- Target: W02 PostgreSQL schema baseline only; production W02 remains on D1-01.
-- Generator: workers/W02-identity/scripts/neon/generate-role-assignment-postgres-migrations.mjs
-- Do not hand-edit. Regenerate from the canonical contracts.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE role_assignments (
  id TEXT NOT NULL PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,
  role_id TEXT NOT NULL CHECK (role_id IN ('admin', 'creator', 'editor', 'ip_principal', 'mcn_admin', 'mcn_editor', 'moderator', 'operator', 'super_admin', 'user', 'verified_user')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'organization', 'ip')),
  scope_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK ((scope_type = 'global' AND scope_id IS NULL) OR (scope_type IN ('organization', 'ip') AND scope_id IS NOT NULL)),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT role_assignments_no_active_overlap
    EXCLUDE USING gist (
      subject_id WITH =,
      role_id WITH =,
      scope_type WITH =,
      (COALESCE(scope_id, '')) WITH =,
      tstzrange(valid_from, valid_until, '[)') WITH &&
    ) WHERE (status = 'ACTIVE')
);

CREATE INDEX role_assignments_subject_id_idx ON role_assignments(subject_id);
CREATE INDEX role_assignments_role_id_idx ON role_assignments(role_id);
CREATE INDEX role_assignments_scope_idx ON role_assignments(scope_type, scope_id);
CREATE INDEX role_assignments_status_idx ON role_assignments(status);
CREATE INDEX role_assignments_valid_from_idx ON role_assignments(valid_from);
CREATE INDEX role_assignments_valid_until_idx ON role_assignments(valid_until);
CREATE INDEX role_assignments_created_at_idx ON role_assignments(created_at);
CREATE INDEX role_assignments_updated_at_idx ON role_assignments(updated_at);
