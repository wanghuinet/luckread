#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const contract = JSON.parse(
  readFileSync(resolve(root, 'contracts/transport/d1-03-entity-owner-boundary.v1.json'), 'utf8'),
)
const allowed = new Set(['W06', 'W09', 'W10', 'W11'])
const owners = contract.owners ?? {}

if (contract.domain !== 'D1-03') throw new Error('Expected D1-03 owner contract')
if (contract.topology?.workerCount !== 12 || contract.topology?.d1Count !== 5 || contract.topology?.taskCount !== 25) {
  throw new Error('D1-03 owner contract topology drift')
}

const seen = new Map()
for (const [worker, entities] of Object.entries(owners)) {
  if (!allowed.has(worker)) throw new Error(`D1-03 owner ${worker} is outside the canonical D1-03 owner set`)
  if (!Array.isArray(entities) || entities.length === 0) throw new Error(`D1-03 owner ${worker} has no entity list`)
  for (const entity of entities) {
    if (seen.has(entity)) throw new Error(`D1-03 entity ${entity} has multiple primary owners`)
    seen.set(entity, worker)
  }
}
if (contract.crossCutting?.AuditEvent?.owner !== 'W09') {
  throw new Error('AuditEvent must have exactly one cross-cutting D1-03 owner')
}
if (seen.has('AuditEvent')) throw new Error('AuditEvent must not also appear in ordinary owner lists')

const w05ConfigPath = resolve(root, 'workers/W05-social/wrangler.jsonc')
const w09MigrationConfigPath = resolve(root, 'workers/W09-platform/wrangler.d1-03-migrations.jsonc')
const w05SourcePath = resolve(root, 'workers/W05-social/src/index.ts')
const pushRuntimePath = resolve(root, 'workers/W05-social/src/push-endpoint-runtime.ts')
const pushMigrationPath = resolve(root, 'workers/W09-platform/migrations-d1-03/0001_notification_push_endpoints.sql')

for (const path of [w05ConfigPath, w09MigrationConfigPath, w05SourcePath, pushRuntimePath, pushMigrationPath]) {
  if (!existsSync(path)) throw new Error(`Missing scoped NotificationPushEndpoint owner artifact: ${path}`)
}

const w05Config = JSON.parse(readFileSync(w05ConfigPath, 'utf8'))
const w05D1Bindings = w05Config.d1_databases ?? []
const w05D1_03 = w05D1Bindings.find((binding) => binding.binding === 'D1_03')
if (
  w05Config.name !== 'luckread-w05' ||
  !w05D1_03 ||
  w05D1_03.database_id !== 'bda1d247-a371-4244-91ae-aef96034db7f' ||
  w05D1_03.database_name !== 'secondary' ||
  w05D1_03.migrations_dir !== undefined
) {
  throw new Error('W05 D1_03 must be the scoped runtime-only binding; W09 owns D1-03 schema migrations')
}

const w05Source = readFileSync(w05SourcePath, 'utf8')
const d1_03References = w05Source.match(/env\.D1_03/g) ?? []
if (
  d1_03References.length !== 2 ||
  !w05Source.includes('upsertPushEndpoint(env.D1_03') ||
  !w05Source.includes('deletePushEndpoint(env.D1_03')
) {
  throw new Error('W05 may reference D1_03 only for the two delegated NotificationPushEndpoint operations')
}

const w09MigrationConfig = JSON.parse(readFileSync(w09MigrationConfigPath, 'utf8'))
const w09D1Bindings = w09MigrationConfig.d1_databases ?? []
if (
  w09MigrationConfig.name !== 'luckread-w09' ||
  w09D1Bindings.length !== 1 ||
  w09D1Bindings[0].binding !== 'D1_03' ||
  w09D1Bindings[0].database_id !== 'bda1d247-a371-4244-91ae-aef96034db7f' ||
  w09D1Bindings[0].database_name !== 'secondary' ||
  w09D1Bindings[0].migrations_dir !== 'migrations-d1-03'
) {
  throw new Error('W09 must be the sole D1-03 schema migration configuration owner')
}

const pushRuntime = readFileSync(pushRuntimePath, 'utf8')
const pushMigration = readFileSync(pushMigrationPath, 'utf8')
if (
  !pushRuntime.includes('notification_push_endpoints') ||
  !pushMigration.includes('CREATE TABLE IF NOT EXISTS notification_push_endpoints') ||
  !pushMigration.includes('MIG-NOTIFY-002-PUSH-ENDPOINTS-V1')
) {
  throw new Error('NotificationPushEndpoint runtime and schema evidence do not match the delegated owner contract')
}

const pushDelegation = contract.scopedDelegations?.NotificationPushEndpoint
if (
  seen.get('NotificationPushEndpoint') !== 'W09' ||
  pushDelegation?.primaryOwner !== 'W09' ||
  pushDelegation?.primaryTask !== 'T25' ||
  pushDelegation?.delegatedWriter !== 'W05' ||
  pushDelegation?.delegatedTask !== 'T14' ||
  !Array.isArray(pushDelegation.allowedOperations) ||
  pushDelegation.allowedOperations.length !== 2 ||
  !pushDelegation.allowedOperations.includes('PUT /v1/push/endpoints/{installationId}') ||
  !pushDelegation.allowedOperations.includes('DELETE /v1/push/endpoints/{installationId}')
) {
  throw new Error('NotificationPushEndpoint must remain W09-owned with only the explicit W05/T14 self-service writer delegation')
}

for (const rule of contract.boundaryRules ?? []) {
  if (typeof rule !== 'string' || rule.length === 0) throw new Error('Invalid D1-03 boundary rule')
}

console.log('D1_03_ENTITY_OWNER_BOUNDARY=PASS')
console.log(JSON.stringify({
  entityOwners: Object.fromEntries(seen),
  auditEventOwner: contract.crossCutting.AuditEvent.owner,
  notificationPushEndpointOwner: seen.get('NotificationPushEndpoint'),
  notificationPushEndpointDelegatedWriter: pushDelegation.delegatedWriter,\n  w05D1_03RuntimeReferences: d1_03References.length,\n  w09D1_03MigrationConfig: 'VERIFIED',
}, null, 2))
