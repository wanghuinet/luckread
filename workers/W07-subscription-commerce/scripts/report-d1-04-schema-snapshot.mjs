import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ADMITTED_D1_04_UUID = '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'
const SCHEMA_OBJECT_TYPES = new Set(['table', 'view', 'index', 'trigger'])
const COMMERCE_OBJECT_PATTERN = /order|payment|ledger|finance|provider|transaction|refund|chargeback|invoice|idempotency|entitlement/i

function fail(message) {
  throw new Error('W07_D1_04_SCHEMA_PREFLIGHT_FAILED: ' + message)
}

function collectObjects(value, output = [], seen = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output, seen)
  } else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    output.push(value)
    for (const item of Object.values(value)) collectObjects(item, output, seen)
  }
  return output
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
}

function extractSchemaObjects(input) {
  const objects = collectObjects(input)
    .filter((row) => SCHEMA_OBJECT_TYPES.has(row.type) &&
      typeof row.name === 'string' && row.name.length > 0 &&
      typeof row.tbl_name === 'string' &&
      Object.prototype.hasOwnProperty.call(row, 'sql'))
    .map((row) => ({
      type: row.type,
      name: row.name,
      tableName: row.tbl_name,
      sql: typeof row.sql === 'string' ? row.sql : null,
    }))
    .sort((left, right) =>
      left.type.localeCompare(right.type) || left.name.localeCompare(right.name))

  const unique = new Map()
  for (const object of objects) {
    const key = object.type + '\u0000' + object.name
    const existing = unique.get(key)
    if (existing && JSON.stringify(existing) !== JSON.stringify(object)) {
      fail('schema query returned conflicting definitions for ' + object.type + ':' + object.name)
    }
    unique.set(key, object)
  }
  return [...unique.values()]
}

/**
 * Build a schema-only report from current remote SQLite metadata. This function
 * never accepts table-row exports; the only data source is sqlite_master plus
 * the Wrangler migration-name table when that table exists.
 */
export function createD1_04SchemaSnapshotReport({ liveNameReport, schemaSnapshot, migrationState }) {
  if (liveNameReport?.result !== 'LIVE_NAME_IDENTIFIED' ||
      liveNameReport?.binding !== 'D1_04' ||
      liveNameReport?.databaseUuid !== ADMITTED_D1_04_UUID ||
      liveNameReport?.displayNameMatches !== true ||
      liveNameReport?.readOnly !== true) {
    fail('current read-only inventory did not prove the admitted D1-04 binding and matching live name')
  }
  const databaseName = liveNameReport.liveDatabaseName
  if (typeof databaseName !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(databaseName)) {
    fail('live database name cannot safely be used as the Wrangler D1 target')
  }

  const schemaObjects = extractSchemaObjects(schemaSnapshot)
  const migrationTablePresent = schemaObjects.some((object) =>
    object.type === 'table' && object.name === 'd1_migrations')

  const querySkipped = typeof migrationState?.querySkipped === 'string'
  const appliedMigrations = [...new Set(collectObjects(migrationState)
    .filter((row) => Object.keys(row).length === 1 &&
      typeof row.name === 'string' &&
      row.name.trim() === row.name &&
      row.name.length > 0 &&
      !Object.prototype.hasOwnProperty.call(row, 'type'))
    .map((row) => row.name))].sort()

  if (migrationTablePresent && querySkipped) {
    fail('d1_migrations exists but its read-only history query was skipped')
  }
  if (!migrationTablePresent && appliedMigrations.length > 0) {
    fail('migration names were returned even though sqlite_master has no d1_migrations table')
  }

  const objectNames = (type) => schemaObjects
    .filter((object) => object.type === type)
    .map((object) => object.name)
  const commerceObjects = schemaObjects.filter((object) =>
    COMMERCE_OBJECT_PATTERN.test(object.name) ||
    COMMERCE_OBJECT_PATTERN.test(object.tableName))

  return {
    result: 'SCHEMA_SNAPSHOT_COLLECTED',
    binding: 'D1_04',
    databaseUuid: ADMITTED_D1_04_UUID,
    databaseName,
    source: 'current read-only Cloudflare D1 inventory and SQLite schema metadata',
    readOnly: true,
    databaseRowsExported: false,
    writesPerformed: false,
    migrationApplied: false,
    deploymentPerformed: false,
    migrationTablePresent,
    migrationHistoryRead: migrationTablePresent,
    appliedMigrations,
    objectCounts: {
      tables: objectNames('table').length,
      views: objectNames('view').length,
      indexes: objectNames('index').length,
      triggers: objectNames('trigger').length,
    },
    tableNames: objectNames('table'),
    viewNames: objectNames('view'),
    indexNames: objectNames('index'),
    triggerNames: objectNames('trigger'),
    existingCommerceObjects: commerceObjects.map((object) => ({
      type: object.type,
      name: object.name,
      tableName: object.tableName,
      sql: object.sql,
    })),
    schemaObjects,
    nextAction: 'Review the existing D1-04 schema and migration history before proposing an isolated order/idempotency migration; this report does not authorize applying migrations or deploying W07.',
  }
}

function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'has-migration-table') {
    if (args.length !== 1) throw new Error('Usage: node report-d1-04-schema-snapshot.mjs has-migration-table <schema-objects.json>')
    const objects = extractSchemaObjects(readJson(args[0]))
    console.log(String(objects.some((object) => object.type === 'table' && object.name === 'd1_migrations')))
    return
  }
  if (mode === 'report') {
    if (args.length !== 4) {
      throw new Error('Usage: node report-d1-04-schema-snapshot.mjs report <live-name-report.json> <schema-objects.json> <migration-state.json> <output.json>')
    }
    const report = createD1_04SchemaSnapshotReport({
      liveNameReport: readJson(args[0]),
      schemaSnapshot: readJson(args[1]),
      migrationState: readJson(args[2]),
    })
    fs.writeFileSync(path.resolve(args[3]), JSON.stringify(report, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    })
    console.log(JSON.stringify({
      result: report.result,
      databaseUuid: report.databaseUuid,
      databaseName: report.databaseName,
      migrationTablePresent: report.migrationTablePresent,
      appliedMigrations: report.appliedMigrations,
      objectCounts: report.objectCounts,
      existingCommerceObjectNames: report.existingCommerceObjects.map((object) => object.name),
      readOnly: report.readOnly,
      writesPerformed: report.writesPerformed,
      migrationApplied: report.migrationApplied,
      deploymentPerformed: report.deploymentPerformed,
      artifactPath: path.resolve(args[3]),
    }, null, 2))
    return
  }
  throw new Error('Expected mode: has-migration-table or report')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
