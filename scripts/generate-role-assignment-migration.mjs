import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const contractPath = resolve(root, 'contracts/entity/AUTHZ-role-assignment-authority.v1.json')
const outputPath = resolve(root, 'workers/W02-content/migrations/0001_role_assignments.sql')
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))

const expected = [
  ['ENT-ROLE-ASSIGNMENT-F-ID', 'id', 'text', false],
  ['ENT-ROLE-ASSIGNMENT-F-SUBJECT-ID', 'subjectId', 'text', false],
  ['ENT-ROLE-ASSIGNMENT-F-ROLE-ID', 'roleId', 'text', false],
  ['ENT-ROLE-ASSIGNMENT-F-SCOPE-TYPE', 'scopeType', 'enum', false],
  ['ENT-ROLE-ASSIGNMENT-F-SCOPE-ID', 'scopeId', 'text', true],
  ['ENT-ROLE-ASSIGNMENT-F-STATUS', 'status', 'enum', false],
  ['ENT-ROLE-ASSIGNMENT-F-VALID-FROM', 'validFrom', 'datetime', false],
  ['ENT-ROLE-ASSIGNMENT-F-VALID-UNTIL', 'validUntil', 'datetime', true],
  ['ENT-ROLE-ASSIGNMENT-F-CREATED-AT', 'createdAt', 'datetime', false],
  ['ENT-ROLE-ASSIGNMENT-F-UPDATED-AT', 'updatedAt', 'datetime', false],
]

if (contract.entityId !== 'ENT-ROLE-ASSIGNMENT') throw new Error('unexpected entity authority')
for (const [fieldId, name, type, nullable] of expected) {
  const field = contract.fields.find((candidate) => candidate.fieldId === fieldId)
  if (!field || field.name !== name || field.type !== type || field.nullable !== nullable) {
    throw new Error('contract field drift: ' + fieldId)
  }
}

const sql = `-- GENERATED FILE
-- Source authority: contracts/entity/AUTHZ-role-assignment-authority.v1.json
-- Physical owner: D1-01 / W02 / T03
-- Generator: scripts/generate-role-assignment-migration.mjs
-- Do not hand-edit. Regenerate from the canonical Contract source.

CREATE TABLE role_assignments (
  id TEXT NOT NULL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'organization', 'ip')),
  scope_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((scope_type = 'global' AND scope_id IS NULL) OR (scope_type IN ('organization', 'ip') AND scope_id IS NOT NULL)),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX role_assignments_subject_id_idx ON role_assignments(subject_id);
CREATE INDEX role_assignments_role_id_idx ON role_assignments(role_id);
CREATE INDEX role_assignments_scope_idx ON role_assignments(scope_type, scope_id);
CREATE INDEX role_assignments_status_idx ON role_assignments(status);
CREATE INDEX role_assignments_valid_from_idx ON role_assignments(valid_from);
CREATE INDEX role_assignments_valid_until_idx ON role_assignments(valid_until);
CREATE INDEX role_assignments_created_at_idx ON role_assignments(created_at);
CREATE INDEX role_assignments_updated_at_idx ON role_assignments(updated_at);

CREATE TRIGGER role_assignments_no_overlap_insert
BEFORE INSERT ON role_assignments
WHEN NEW.status = 'ACTIVE'
BEGIN
  SELECT RAISE(ABORT, 'role assignment effective interval overlaps existing assignment')
  WHERE EXISTS (
    SELECT 1 FROM role_assignments AS r
    WHERE r.status = 'ACTIVE'
      AND r.subject_id = NEW.subject_id
      AND r.role_id = NEW.role_id
      AND r.scope_type = NEW.scope_type
      AND COALESCE(r.scope_id, '') = COALESCE(NEW.scope_id, '')
      AND NEW.valid_from < COALESCE(r.valid_until, '9999-12-31T23:59:59.999Z')
      AND r.valid_from < COALESCE(NEW.valid_until, '9999-12-31T23:59:59.999Z')
  );
END;

CREATE TRIGGER role_assignments_no_overlap_update
BEFORE UPDATE OF status, valid_from, valid_until, subject_id, role_id, scope_type, scope_id
ON role_assignments
WHEN NEW.status = 'ACTIVE'
BEGIN
  SELECT RAISE(ABORT, 'role assignment effective interval overlaps existing assignment')
  WHERE EXISTS (
    SELECT 1 FROM role_assignments AS r
    WHERE r.id <> NEW.id
      AND r.status = 'ACTIVE'
      AND r.subject_id = NEW.subject_id
      AND r.role_id = NEW.role_id
      AND r.scope_type = NEW.scope_type
      AND COALESCE(r.scope_id, '') = COALESCE(NEW.scope_id, '')
      AND NEW.valid_from < COALESCE(r.valid_until, '9999-12-31T23:59:59.999Z')
      AND r.valid_from < COALESCE(NEW.valid_until, '9999-12-31T23:59:59.999Z')
  );
END;
`

writeFileSync(outputPath, sql)
console.log('ROLE_ASSIGNMENT_MIGRATION_GENERATION_PASS')
