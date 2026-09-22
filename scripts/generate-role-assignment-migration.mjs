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

const sql = readFileSync(outputPath, 'utf8')
if (!sql.startsWith('-- GENERATED FILE')) throw new Error('migration is not generated output')
if (!sql.includes('-- Source authority: contracts/entity/AUTHZ-role-assignment-authority.v1.json')) {
  throw new Error('migration authority marker missing')
}
writeFileSync(outputPath, sql)
console.log('ROLE_ASSIGNMENT_MIGRATION_GENERATION_PASS')
