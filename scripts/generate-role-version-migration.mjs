import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const contractPath = resolve(root, 'contracts/entity/AUTHZ-role-assignment-authority.v1.json')
const outputPath = resolve(root, 'workers/W02-content/migrations/0003_role_authorization_versions.sql')
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))

const requiredRules = [contract.rules?.revocation, contract.rules?.authorizationVersion]
if (
  requiredRules.length !== 2 ||
  !requiredRules.every((rule) => typeof rule === 'string' && rule.includes('role_version'))
) {
  throw new Error('contract role_version semantics missing')
}

const sql = `-- GENERATED FILE
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

CREATE TRIGGER role_authorization_versions_on_role_assignment_insert
AFTER INSERT ON role_assignments
BEGIN
  INSERT INTO role_authorization_versions (subject_id, role_version, updated_at)
  VALUES (NEW.subject_id, 1, CURRENT_TIMESTAMP)
  ON CONFLICT(subject_id) DO UPDATE SET
    role_version = role_authorization_versions.role_version + 1,
    updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER role_authorization_versions_on_role_assignment_change
AFTER UPDATE OF status, valid_from, valid_until, subject_id, role_id, scope_type, scope_id
ON role_assignments
BEGIN
  INSERT INTO role_authorization_versions (subject_id, role_version, updated_at)
  VALUES (NEW.subject_id, 1, CURRENT_TIMESTAMP)
  ON CONFLICT(subject_id) DO UPDATE SET
    role_version = role_authorization_versions.role_version + 1,
    updated_at = CURRENT_TIMESTAMP;
END;
`

writeFileSync(outputPath, sql)
console.log('ROLE_VERSION_MIGRATION_GENERATION_PASS')
