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
const deliveryRuntimePath = resolve(root, 'workers/W05-social/src/notification-push-delivery-runtime.ts')
const fanoutRuntimePath = resolve(root, 'workers/W05-social/src/notification-push-fanout-runtime.ts')
const endpointAccessPortPath = resolve(root, 'workers/W05-social/src/notification-push-endpoint-access-store.ts')
const endpointAccessPostgresPath = resolve(root, 'workers/W05-social/src/notification-push-endpoint-access-store-postgres.ts')
const endpointAccessRuntimePath = resolve(root, 'workers/W05-social/src/notification-push-endpoint-access-runtime.ts')
const deliveryContractPath = resolve(root, 'contracts/transport/W05-W09-notification-push-delivery.v1.json')
const pushMigrationPath = resolve(root, 'workers/W09-platform/migrations-d1-03/0001_notification_push_endpoints.sql')
const auditSchemaPath = resolve(root, 'contracts/schemas/common/audit-event.json')
const w06MigrationReadmePath = resolve(root, 'workers/W06-governance/migrations/README.md')
const w09NeonMigrationPath = resolve(root, 'workers/W09-platform/src/neon-postgres-migrations/0001_w09_d1_03_platform_schema.sql')
const w09NeonSchemaContractPath = resolve(root, 'contracts/database/neon-d1-03-w09-platform-schema.v1.json')
const repostRuntimePath = resolve(root, 'workers/W05-social/src/repost-runtime.ts')
const repostStorePath = resolve(root, 'workers/W05-social/src/repost-store.ts')
const shareRuntimePath = resolve(root, 'workers/W05-social/src/share-runtime.ts')
const shareStorePath = resolve(root, 'workers/W05-social/src/share-store.ts')
const profilePinRuntimePath = resolve(root, 'workers/W05-social/src/profile-pin-runtime.ts')
const profilePinStorePath = resolve(root, 'workers/W05-social/src/profile-pin-store.ts')

for (const path of [w05ConfigPath, w09MigrationConfigPath, w05SourcePath, pushRuntimePath, deliveryRuntimePath, fanoutRuntimePath, endpointAccessPortPath, endpointAccessPostgresPath, endpointAccessRuntimePath, deliveryContractPath, pushMigrationPath, auditSchemaPath, w06MigrationReadmePath, w09NeonMigrationPath, w09NeonSchemaContractPath, repostRuntimePath, repostStorePath, shareRuntimePath, shareStorePath, profilePinRuntimePath, profilePinStorePath]) {
  if (!existsSync(path)) throw new Error(`Missing scoped NotificationPushEndpoint owner artifact: ${path}`)
}

const w05Config = JSON.parse(readFileSync(w05ConfigPath, 'utf8'))
const w05D1Bindings = w05Config.d1_databases ?? []
const w05Hyperdrive = w05Config.hyperdrive ?? []
if (
  w05Config.name !== 'luckread-w05' ||
  w05D1Bindings.length !== 0 ||
  w05Config.vars?.W05_DATABASE_DRIVER !== 'neon' ||
  w05Config.vars?.W05_PUSH_ENDPOINT_DATABASE_DRIVER !== 'neon' ||
  !w05Hyperdrive.some((item) => item.binding === 'HYPERDRIVE_D1_02' && item.id === 'c55183e1cc3446409c9c1075832c6615') ||
  !w05Hyperdrive.some((item) => item.binding === 'HYPERDRIVE_D1_03' && item.id === '7c8831416c18494faee04b96aa551cb9') ||
  existsSync(resolve(root, 'workers/W05-social/migrations-d1-03'))
) {
  throw new Error('W05 must use both existing Neon Hyperdrive databases with no production D1 bindings; all D1-03 schema migrations belong to W09')
}

const w05Source = readFileSync(w05SourcePath, 'utf8')
const w05Entry = readFileSync(resolve(root, 'workers/W05-social/src/entry.ts'), 'utf8')
if (
  !w05Entry.includes('getW05SocialWorkerDependencies(env)') ||
  !w05Entry.includes('getW05PushEndpointPostgresDatabase(env)')
) {
  throw new Error('W05 production entry must inject the Neon social stores and W09-owned endpoint PostgreSQL executor')
}
const d1_03References = w05Source.match(/env\.D1_03/g) ?? []
if (
  d1_03References.length !== 0 ||
  !w05Entry.includes('pushEndpointDatabase: getW05PushEndpointPostgresDatabase(env)') ||
  !w05Source.includes('upsertPushEndpoint(dependencies.pushEndpointDatabase') ||
  !w05Source.includes('deletePushEndpoint(dependencies.pushEndpointDatabase')
) {
  throw new Error('W05 must use the existing HYPERDRIVE_D1_03 Neon executor for the two delegated NotificationPushEndpoint operations, with no D1_03 binding fallback')
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


const auditSchema = JSON.parse(readFileSync(auditSchemaPath, 'utf8'))
const w06MigrationReadme = readFileSync(w06MigrationReadmePath, 'utf8')
const w09NeonMigration = readFileSync(w09NeonMigrationPath, 'utf8')
const w09NeonSchemaContract = JSON.parse(readFileSync(w09NeonSchemaContractPath, 'utf8'))
if (
  auditSchema['x-luckread']?.['authoritative-writer'] !== 'W09' ||
  auditSchema['x-luckread']?.neonSchemaOwner !== 'W09' ||
  auditSchema['x-luckread']?.legacyCloudflareD1CompatibilityWriter !== 'W06' ||
  auditSchema['x-luckread']?.legacyCloudflareD1CompatibilityStatus !== 'RETAINED_UNTIL_SEPARATE_RUNTIME_ADAPTER_SLICE' ||
  !w06MigrationReadme.includes('legacy Cloudflare D1 migrations') ||
  !w06MigrationReadme.includes('Do not execute this SQLite/D1 migration against Neon PostgreSQL') ||
  !w09NeonMigration.includes('CREATE TABLE audit_events') ||
  !w09NeonMigration.includes('CREATE TABLE notification_push_endpoints') ||
  !w09NeonMigration.includes('BEFORE TRUNCATE ON audit_events') ||
  w09NeonSchemaContract.target?.domainId !== 'D1-03' ||
  w09NeonSchemaContract.target?.databaseName !== 'luckread_governance' ||
  w09NeonSchemaContract.primaryOwner?.worker !== 'W09' ||
  w09NeonSchemaContract.schema?.totals?.tables !== 2
) {
  throw new Error('W09 D1-03 Neon schema source and legacy W06 D1 compatibility boundary are not aligned')
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

const repostRuntime = readFileSync(repostRuntimePath, 'utf8')
const repostStore = readFileSync(repostStorePath, 'utf8')
const shareRuntime = readFileSync(shareRuntimePath, 'utf8')
const shareStore = readFileSync(shareStorePath, 'utf8')
const profilePinRuntime = readFileSync(profilePinRuntimePath, 'utf8')
const profilePinStore = readFileSync(profilePinStorePath, 'utf8')
for (const [name, source] of Object.entries({
  repostRuntime, repostStore, shareRuntime, shareStore, profilePinRuntime, profilePinStore,
})) {
  if (source.includes('D1Database') || source.includes('createD1') || source.includes('D1QueryExecutor')) {
    throw new Error(`W05 publication relation runtime must not retain D1 fallback: ${name}`)
  }
}

const deliveryRuntime = readFileSync(deliveryRuntimePath, 'utf8')
const fanoutRuntime = readFileSync(fanoutRuntimePath, 'utf8')
const endpointAccessPort = readFileSync(endpointAccessPortPath, 'utf8')
const endpointAccessPostgres = readFileSync(endpointAccessPostgresPath, 'utf8')
const endpointAccessRuntime = readFileSync(endpointAccessRuntimePath, 'utf8')
const deliveryContract = JSON.parse(readFileSync(deliveryContractPath, 'utf8'))
const runtimeDelegation = pushDelegation?.delegatedDeliveryRuntime
const deliveryOperations = new Set((deliveryContract.operations ?? []).map((operation) => operation.id))
if (
  runtimeDelegation?.worker !== 'W05' ||
  runtimeDelegation?.task !== 'T14' ||
  runtimeDelegation?.contractRef !== 'contracts/transport/W05-W09-notification-push-delivery.v1.json' ||
  !Array.isArray(runtimeDelegation.allowedOperations) ||
  runtimeDelegation.allowedOperations.length !== 2 ||
  !runtimeDelegation.allowedOperations.includes('resolveActiveRecipientPushEndpoints') ||
  !runtimeDelegation.allowedOperations.includes('clearProviderInvalidExpoToken') ||
  deliveryContract.primaryOwner?.worker !== 'W09' ||
  deliveryContract.primaryOwner?.task !== 'T25' ||
  deliveryContract.delegatedRuntime?.worker !== 'W05' ||
  deliveryContract.authority?.maxEndpointsPerRecipient !== 20 ||
  !deliveryOperations.has('resolveActiveRecipientPushEndpoints') ||
  !deliveryOperations.has('clearProviderInvalidExpoToken') ||
  !endpointAccessPort.includes('listActiveForRecipient') ||
  !endpointAccessPort.includes('findEndpointForOwner') ||
  !endpointAccessPort.includes('clearTokenIfMatches') ||
  !deliveryRuntime.includes('endpointStore.findEndpointForOwner') ||
  !deliveryRuntime.includes('deactivateInvalidNotificationPushEndpoint') ||
  !endpointAccessRuntime.includes('store.clearTokenIfMatches') ||
  !fanoutRuntime.includes('endpointStore.listActiveForRecipient') ||
  !endpointAccessRuntime.includes('await hashNotificationPushToken(endpoint.push_token) !== task.pushTokenHash') ||
  !deliveryRuntime.includes("errorCode === 'DeviceNotRegistered'") ||
  deliveryRuntime.includes('notification_push_endpoints') ||
  fanoutRuntime.includes('notification_push_endpoints') ||
   existsSync(resolve(root, 'workers/W05-social/src/notification-push-endpoint-access-store-d1.ts')) ||
   deliveryRuntime.includes('createD1') ||
   deliveryRuntime.includes('D1Database') ||
   deliveryRuntime.includes('env.DB') ||
   deliveryRuntime.includes('env.D1_03') ||
   fanoutRuntime.includes('createD1') ||
   fanoutRuntime.includes('D1Database') ||
  !endpointAccessPostgres.includes('owner_user_id = $1') ||
  !endpointAccessPostgres.includes("provider = 'expo'") ||
  !endpointAccessPostgres.includes("permission_status = 'granted'") ||
  !endpointAccessPostgres.includes('LIMIT $2') ||
  !endpointAccessPostgres.includes('AND push_token = $4') ||
  !endpointAccessPostgres.includes('RETURNING endpoint_id') ||
  deliveryRuntime.includes('last_seen_at =') ||
  fanoutRuntime.includes('last_seen_at =')
) {
  throw new Error('W05 notification delivery and publication relation routes must use scoped Neon Store ports without D1 fallback')
}

for (const rule of contract.boundaryRules ?? []) {
  if (typeof rule !== 'string' || rule.length === 0) throw new Error('Invalid D1-03 boundary rule')
}

console.log('D1_03_ENTITY_OWNER_BOUNDARY=PASS')
console.log(JSON.stringify({
  entityOwners: Object.fromEntries(seen),
  auditEventOwner: contract.crossCutting.AuditEvent.owner,
  notificationPushEndpointOwner: seen.get('NotificationPushEndpoint'),
  notificationPushEndpointDelegatedWriter: pushDelegation.delegatedWriter,
  notificationPushDeliveryRuntimeContract: deliveryContractPath,
  w05D1_03RuntimeReferences: d1_03References.length,
  w09D1_03MigrationConfig: 'VERIFIED',
}, null, 2))
