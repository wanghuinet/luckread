import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDir, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const contractPath = resolve(repositoryRoot, 'contracts/entity/AUTHZ-role-assignment-authority.v1.json')
const layersPath = resolve(repositoryRoot, 'contracts/authz/layers.json')
const outputDirectory = resolve(workerRoot, 'src/neon-postgres-migrations')

const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const layers = JSON.parse(readFileSync(layersPath, 'utf8'))

const expectedFields = [
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

if (contract.entityId !== 'ENT-ROLE-ASSIGNMENT') throw new Error('unexpected RoleAssignment authority contract')
for (const [fieldId, name, type, nullable] of expectedFields) {
  const field = contract.fields.find((candidate) => candidate.fieldId === fieldId)
  if (!field || field.name !== name || field.type !== type || field.nullable !== nullable) {
    throw new Error('RoleAssignment contract field drift: ' + fieldId)
  }
}

if (contract.authority?.roleIdentifierSource !== 'contracts/authz/layers.json#x-layers[].roles') {
  throw new Error('RoleAssignment role vocabulary source drift')
}
if (
  typeof contract.rules?.uniqueness !== 'string' ||
  !contract.rules.uniqueness.includes('Concurrent effective duplicates are forbidden') ||
  typeof contract.rules?.roleMapping !== 'string' ||
  !contract.rules.roleMapping.includes('unknown or forbidden roles are invalid') ||
  typeof contract.rules?.revocation !== 'string' ||
  !contract.rules.revocation.includes('increment role_version') ||
  typeof contract.rules?.authorizationVersion !== 'string' ||
  !contract.rules.authorizationVersion.includes('role_version')
) {
  throw new Error('RoleAssignment uniqueness, role mapping, or version semantics are missing')
}

const roleIds = [...new Set((layers['x-layers'] ?? []).flatMap((layer) => layer.roles ?? []))].sort()
const forbiddenRoles = new Set(layers['x-forbidden-roles'] ?? [])
if (
  roleIds.length === 0 ||
  roleIds.some((roleId) => typeof roleId !== 'string' || !/^[a-z][a-z0-9_]*$/.test(roleId)) ||
  roleIds.some((roleId) => forbiddenRoles.has(roleId))
) {
  throw new Error('Canonical L0-L8 role vocabulary is invalid')
}
const roleIdsSql = roleIds.map((roleId) => "'" + roleId + "'").join(', ')

const roleAssignmentsSql = [
  '-- GENERATED FILE',
  '-- Source authority: contracts/entity/AUTHZ-role-assignment-authority.v1.json',
  '-- Role vocabulary: contracts/authz/layers.json#x-layers[].roles',
  '-- Target: W02 PostgreSQL schema baseline only; production W02 remains on D1-01.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-role-assignment-postgres-migrations.mjs',
  '-- Do not hand-edit. Regenerate from the canonical contracts.',
  '',
  'CREATE EXTENSION IF NOT EXISTS btree_gist;',
  '',
  'CREATE TABLE role_assignments (',
  '  id TEXT NOT NULL PRIMARY KEY,',
  '  subject_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,',
  '  role_id TEXT NOT NULL CHECK (role_id IN (' + roleIdsSql + ')),',
  "  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'organization', 'ip')),",
  '  scope_id TEXT,',
  "  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),",
  '  valid_from TIMESTAMPTZ NOT NULL,',
  '  valid_until TIMESTAMPTZ,',
  '  created_at TIMESTAMPTZ NOT NULL,',
  '  updated_at TIMESTAMPTZ NOT NULL,',
  "  CHECK ((scope_type = 'global' AND scope_id IS NULL) OR (scope_type IN ('organization', 'ip') AND scope_id IS NOT NULL)),",
  '  CHECK (valid_until IS NULL OR valid_until > valid_from),',
  '  CONSTRAINT role_assignments_no_active_overlap',
  '    EXCLUDE USING gist (',
  '      subject_id WITH =,',
  '      role_id WITH =,',
  '      scope_type WITH =,',
  "      (COALESCE(scope_id, '')) WITH =,",
  "      tstzrange(valid_from, valid_until, '[)') WITH &&",
  "    ) WHERE (status = 'ACTIVE')",
  ');',
  '',
  'CREATE INDEX role_assignments_subject_id_idx ON role_assignments(subject_id);',
  'CREATE INDEX role_assignments_role_id_idx ON role_assignments(role_id);',
  'CREATE INDEX role_assignments_scope_idx ON role_assignments(scope_type, scope_id);',
  'CREATE INDEX role_assignments_status_idx ON role_assignments(status);',
  'CREATE INDEX role_assignments_valid_from_idx ON role_assignments(valid_from);',
  'CREATE INDEX role_assignments_valid_until_idx ON role_assignments(valid_until);',
  'CREATE INDEX role_assignments_created_at_idx ON role_assignments(created_at);',
  'CREATE INDEX role_assignments_updated_at_idx ON role_assignments(updated_at);',
  '',
].join('\n')

const roleVersionsSql = [
  '-- GENERATED FILE',
  '-- Source authority: contracts/entity/AUTHZ-role-assignment-authority.v1.json',
  '-- Logical contract: assignment-set changes advance the subject authorization version.',
  '-- Target: W02 PostgreSQL schema baseline only; production W02 remains on D1-01.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-role-assignment-postgres-migrations.mjs',
  '-- Do not hand-edit. Regenerate from the canonical contracts.',
  '',
  'CREATE TABLE role_authorization_versions (',
  '  subject_id TEXT NOT NULL PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,',
  '  role_version INTEGER NOT NULL CHECK (role_version >= 1),',
  '  updated_at TIMESTAMPTZ NOT NULL',
  ');',
  '',
  'CREATE INDEX role_authorization_versions_updated_at_idx',
  '  ON role_authorization_versions(updated_at);',
  '',
  'CREATE OR REPLACE FUNCTION advance_role_authorization_version()',
  'RETURNS TRIGGER',
  'LANGUAGE plpgsql',
  'AS $function$',
  'BEGIN',
  '  INSERT INTO role_authorization_versions (subject_id, role_version, updated_at)',
  '  VALUES (NEW.subject_id, 1, CURRENT_TIMESTAMP)',
  '  ON CONFLICT (subject_id) DO UPDATE SET',
  '    role_version = role_authorization_versions.role_version + 1,',
  '    updated_at = CURRENT_TIMESTAMP;',
  '  RETURN NEW;',
  'END;',
  '$function$;',
  '',
  'CREATE TRIGGER role_authorization_versions_on_role_assignment_insert',
  'AFTER INSERT ON role_assignments',
  'FOR EACH ROW EXECUTE FUNCTION advance_role_authorization_version();',
  '',
  'CREATE TRIGGER role_authorization_versions_on_role_assignment_change',
  'AFTER UPDATE OF status, valid_from, valid_until, subject_id, role_id, scope_type, scope_id',
  'ON role_assignments',
  'FOR EACH ROW EXECUTE FUNCTION advance_role_authorization_version();',
  '',
].join('\n')

mkdirSync(outputDirectory, { recursive: true })
writeFileSync(resolve(outputDirectory, '0001_role_assignments.sql'), roleAssignmentsSql)
writeFileSync(resolve(outputDirectory, '0002_role_authorization_versions.sql'), roleVersionsSql)
console.log('W02_ROLE_ASSIGNMENT_POSTGRES_MIGRATION_GENERATION_PASS')
