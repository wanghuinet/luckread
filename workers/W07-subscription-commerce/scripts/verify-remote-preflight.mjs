import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EXPECTED_DATABASE_NAME = 'luckread'
const EXPECTED_DATABASE_ID = '2f80471e-3756-49f9-8db1-7707a433ad64'
const BASELINE_MIGRATION = '0001_membership_subscriptions'
const VERSION_MIGRATION = '0002_subscription_version_cas'

const EXPECTED_INDEXES = [
  'ix_membership_subscriptions_subscriber_status_period',
  'ix_membership_subscriptions_plan_version',
  'ix_membership_subscriptions_creator_status',
  'ix_membership_subscriptions_updated_at',
]

const LEGACY_COLUMNS = [
  ['subscription_id', 'TEXT', 1, 1],
  ['subscriber_id', 'TEXT', 1, 0],
  ['plan_id', 'TEXT', 1, 0],
  ['plan_version', 'INTEGER', 1, 0],
  ['creator_id', 'TEXT', 0, 0],
  ['status', 'TEXT', 1, 0],
  ['started_at', 'TEXT', 1, 0],
  ['current_period_start', 'TEXT', 1, 0],
  ['current_period_end', 'TEXT', 1, 0],
  ['cancel_at', 'TEXT', 0, 0],
  ['entitlement_snapshot_ref', 'TEXT', 0, 0],
  ['created_at', 'TEXT', 1, 0],
  ['updated_at', 'TEXT', 1, 0],
]

const CURRENT_COLUMNS = [...LEGACY_COLUMNS, ['version', 'INTEGER', 1, 0]]

const fail = (message) => {
  throw new Error('READ_ONLY_PREFLIGHT_FAILED: ' + message)
}

const collectObjects = (value, output = []) => {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output)
  } else if (value && typeof value === 'object') {
    output.push(value)
    for (const item of Object.values(value)) collectObjects(item, output)
  }
  return output
}

const columnsFrom = (value) => collectObjects(value)
  .filter((item) => Number.isInteger(item.cid) &&
    typeof item.name === 'string' &&
    typeof item.type === 'string' &&
    Object.prototype.hasOwnProperty.call(item, 'notnull') &&
    Object.prototype.hasOwnProperty.call(item, 'pk'))
  .sort((left, right) => left.cid - right.cid)
  .map((item) => ({
    name: item.name,
    type: item.type,
    notnull: Number(item.notnull),
    primaryKey: Number(item.pk),
    defaultValue: item.dflt_value,
  }))

const indexNamesFrom = (value) => new Set(collectObjects(value)
  .filter((item) => Number.isInteger(item.seq) && typeof item.name === 'string')
  .map((item) => item.name))

export function verifyD1SubscriptionPreflight({
  databaseList,
  migrationState,
  subscriptionSchema,
  subscriptionIndexes,
  subscriptionForeignKeys = [],
  expectedDatabaseName = EXPECTED_DATABASE_NAME,
  expectedDatabaseId = EXPECTED_DATABASE_ID,
}) {
  const databases = collectObjects(databaseList)
  const hasExactDatabase = databases.some((item) =>
    item.name === expectedDatabaseName &&
    (item.uuid === expectedDatabaseId || item.database_id === expectedDatabaseId))
  if (!hasExactDatabase) fail('exact D1-01 database name/UUID was not found')

  const appliedMigrations = [...new Set(collectObjects(migrationState)
    .filter((item) => item.name === BASELINE_MIGRATION || item.name === VERSION_MIGRATION)
    .map((item) => item.name))].sort()
  if (!appliedMigrations.includes(BASELINE_MIGRATION)) {
    fail('baseline migration 0001 is not recorded as applied')
  }

  const columns = columnsFrom(subscriptionSchema)
  const shape = columns.map(({ name, type, notnull, primaryKey }) => [name, type, notnull, primaryKey])
  const foreignKeyRows = collectObjects(subscriptionForeignKeys)
    .filter((item) => Object.prototype.hasOwnProperty.call(item, 'from') &&
      Object.prototype.hasOwnProperty.call(item, 'table') &&
      typeof item.from === 'string')
  if (foreignKeyRows.length > 0) fail('physical foreign keys are forbidden for Subscription')
  const indexNames = indexNamesFrom(subscriptionIndexes)
  for (const name of EXPECTED_INDEXES) {
    if (!indexNames.has(name)) fail('missing expected index ' + name)
  }

  let migrationAction
  if (JSON.stringify(appliedMigrations) === JSON.stringify([BASELINE_MIGRATION]) &&
      JSON.stringify(shape) === JSON.stringify(LEGACY_COLUMNS)) {
    if (columns.some((column) => column.name === 'version')) {
      fail('version column exists but migration 0002 is not recorded as applied')
    }
    migrationAction = 'apply'
  } else if (JSON.stringify(appliedMigrations) === JSON.stringify([BASELINE_MIGRATION, VERSION_MIGRATION]) &&
      JSON.stringify(shape) === JSON.stringify(CURRENT_COLUMNS)) {
    const versionColumn = columns.find((column) => column.name === 'version')
    if (!versionColumn || versionColumn.type !== 'INTEGER' || versionColumn.notnull !== 1 ||
        versionColumn.primaryKey !== 0 || ![1, '1'].includes(versionColumn.defaultValue)) {
      fail('version column does not satisfy INTEGER NOT NULL DEFAULT 1')
    }
    migrationAction = 'skip'
  } else {
    fail('migration history and physical Subscription schema do not match an admitted state')
  }

  return {
    migrationAction,
    databaseName: expectedDatabaseName,
    databaseId: expectedDatabaseId,
    appliedMigrations,
    columns: shape,
    indexes: [...EXPECTED_INDEXES],
    foreignKeyCount: foreignKeyRows.length,
  }
}

export function verifyD1SubscriptionPostflight(input) {
  const report = verifyD1SubscriptionPreflight(input)
  if (report.migrationAction !== 'skip') {
    fail('post-migration verification requires 0001 and 0002 with the exact current schema')
  }

  const integrityRows = collectObjects(input.versionIntegrity)
    .filter((item) => Object.prototype.hasOwnProperty.call(item, 'invalid_versions'))
  if (integrityRows.length !== 1) fail('version integrity query did not return exactly one count')
  const invalidVersions = Number(integrityRows[0].invalid_versions)
  if (!Number.isSafeInteger(invalidVersions) || invalidVersions !== 0) {
    fail('existing subscription versions include invalid or non-positive values')
  }

  return { ...report, invalidVersions, postflight: 'PASS' }
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

function main() {
  const [mode, ...filePaths] = process.argv.slice(2)
  const isPostflight = mode === 'postflight'
  if (!isPostflight && mode !== 'preflight') {
    throw new Error('Usage: node scripts/verify-remote-preflight.mjs <preflight|postflight> <database-list.json> <migration-state.json> <subscription-schema.json> <subscription-indexes.json> <subscription-foreign-keys.json> [version-integrity.json]')
  }
  const requiredCount = isPostflight ? 6 : 5
  if (filePaths.length !== requiredCount || filePaths.some((value) => !value)) {
    throw new Error('Invalid arguments for D1 subscription preflight verification')
  }

  const [databaseListPath, migrationStatePath, schemaPath, indexesPath, foreignKeysPath, versionIntegrityPath] = filePaths
  const input = {
    databaseList: readJson(path.resolve(databaseListPath)),
    migrationState: readJson(path.resolve(migrationStatePath)),
    subscriptionSchema: readJson(path.resolve(schemaPath)),
    subscriptionIndexes: readJson(path.resolve(indexesPath)),
    subscriptionForeignKeys: readJson(path.resolve(foreignKeysPath)),
  }
  if (isPostflight) {
    const report = verifyD1SubscriptionPostflight({
      ...input,
      versionIntegrity: readJson(path.resolve(versionIntegrityPath)),
    })
    console.log(JSON.stringify({ readOnlyPostflight: 'PASS', ...report }))
    return
  }

  const report = verifyD1SubscriptionPreflight(input)
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) throw new Error('GITHUB_OUTPUT is unavailable; refusing to continue deployment')
  fs.appendFileSync(outputPath, 'migration_action=' + report.migrationAction + '\n')
  console.log(JSON.stringify({ readOnlyPreflight: 'PASS', ...report }))
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
