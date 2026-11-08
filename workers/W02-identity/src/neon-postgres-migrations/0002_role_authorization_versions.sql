-- GENERATED FILE
-- Source authority: contracts/entity/AUTHZ-role-assignment-authority.v1.json
-- Logical contract: assignment-set changes advance the subject authorization version.
-- Target: W02 PostgreSQL schema baseline only; production W02 remains on D1-01.
-- Generator: workers/W02-identity/scripts/neon/generate-role-assignment-postgres-migrations.mjs
-- Do not hand-edit. Regenerate from the canonical contracts.

CREATE TABLE role_authorization_versions (
  subject_id TEXT NOT NULL PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  role_version INTEGER NOT NULL CHECK (role_version >= 1),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX role_authorization_versions_updated_at_idx
  ON role_authorization_versions(updated_at);

CREATE OR REPLACE FUNCTION advance_role_authorization_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO role_authorization_versions (subject_id, role_version, updated_at)
  VALUES (NEW.subject_id, 1, CURRENT_TIMESTAMP)
  ON CONFLICT (subject_id) DO UPDATE SET
    role_version = role_authorization_versions.role_version + 1,
    updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER role_authorization_versions_on_role_assignment_insert
AFTER INSERT ON role_assignments
FOR EACH ROW EXECUTE FUNCTION advance_role_authorization_version();

CREATE TRIGGER role_authorization_versions_on_role_assignment_change
AFTER UPDATE OF status, valid_from, valid_until, subject_id, role_id, scope_type, scope_id
ON role_assignments
FOR EACH ROW EXECUTE FUNCTION advance_role_authorization_version();
