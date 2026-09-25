-- GENERATED FILE
-- Source authority: contracts/entity/AUTHZ-role-assignment-authority.v1.json
-- Physical owner: D1-01 / W02 / T03
-- Generator: scripts/generate-role-version-migration.mjs
-- Do not hand-edit. Regenerate from the canonical Contract source.

CREATE TABLE role_authorization_versions (
  subject_id TEXT NOT NULL PRIMARY KEY,
  role_version INTEGER NOT NULL CHECK (role_version >= 1),
  updated_at TEXT NOT NULL
);

CREATE INDEX role_authorization_versions_updated_at_idx
  ON role_authorization_versions(updated_at);
