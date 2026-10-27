import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ADMITTED_D1_04_UUID = '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'
export const ORDER_MIGRATION_ID = '0001_order_commerce'

const REQUIRED_COLUMNS = {
  orders: [
    ['order_id', 'TEXT', 1, 1], ['customer_id', 'TEXT', 1, 0], ['status', 'TEXT', 1, 0],
    ['version', 'INTEGER', 1, 0], ['currency', 'TEXT', 1, 0], ['subtotal_minor', 'INTEGER', 1, 0],
    ['discount_minor', 'INTEGER', 1, 0], ['tax_minor', 'INTEGER', 1, 0], ['total_minor', 'INTEGER', 1, 0],
    ['created_at', 'TEXT', 1, 0], ['updated_at', 'TEXT', 1, 0], ['confirmed_at', 'TEXT', 0, 0],
    ['cancelled_at', 'TEXT', 0, 0], ['failure_code', 'TEXT', 0, 0],
  ],
  order_lines: [
    ['order_line_id', 'TEXT', 1, 1], ['order_id', 'TEXT', 1, 0], ['item_type', 'TEXT', 1, 0],
    ['item_ref', 'TEXT', 1, 0], ['item_version', 'TEXT', 1, 0], ['quantity', 'INTEGER', 1, 0],
    ['unit_amount_minor', 'INTEGER', 1, 0], ['line_subtotal_minor', 'INTEGER', 1, 0],
    ['line_discount_minor', 'INTEGER', 1, 0], ['line_tax_minor', 'INTEGER', 1, 0],
    ['line_total_minor', 'INTEGER', 1, 0], ['item_snapshot_json', 'TEXT', 1, 0], ['created_at', 'TEXT', 1, 0],
  ],
  order_create_idempotency: [
    ['id', 'TEXT', 1, 1], ['customer_id', 'TEXT', 1, 0], ['operation_key', 'TEXT', 1, 0],
    ['idempotency_key', 'TEXT', 1, 0], ['request_hash', 'TEXT', 1, 0], ['state', 'TEXT', 1, 0],
    ['response_status', 'INTEGER', 0, 0], ['response_json', 'TEXT', 0, 0],
    ['created_at', 'TEXT', 1, 0], ['expires_at', 'TEXT', 1, 0],
  ],
}

const REQUIRED_INDEXES = {
  orders: ['ix_orders_customer_created_order', 'ix_orders_status_created_order'],
  order_lines: ['ix_order_lines_order_id', 'ix_order_lines_item_ref_version'],
  order_create_idempotency: ['ix_order_create_idempotency_customer_created', 'ix_order_create_idempotency_expiration'],
}

const REQUIRED_TRIGGERS = {
  orders: [
    'orders_commercial_snapshot_immutable', 'orders_version_must_advance',
    'orders_status_transition_guard', 'orders_retained',
  ],
  order_lines: ['order_lines_require_order', 'order_lines_immutable_update', 'order_lines_retained'],
  order_create_idempotency: [
    'order_create_idempotency_identity_immutable', 'order_create_idempotency_terminal_immutable',
  ],
}

const TARGET_OBJECT_NAMES = new Set([
  ...Object.keys(REQUIRED_COLUMNS),
  ...Object.values(REQUIRED_INDEXES).flat(),
  ...Object.values(REQUIRED_TRIGGERS).flat(),
])

function fail(message) {
  throw new Error('W07_D1_04_ORDER_MIGRATION_GATE_FAILED: ' + message)
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

function schemaObjects(input) {
  const objects = collectObjects(input)
    .filter((row) =>
      ['table', 'view', 'index', 'trigger'].includes(row.type) &&
      typeof row.name === 'string' && typeof row.tbl_name === 'string' &&
      Object.prototype.hasOwnProperty.call(row, 'sql'))
    .map((row) => ({
      type: row.type,
      name: row.name,
      tableName: row.tbl_name,
      sql: typeof row.sql === 'string' ? row.sql : null,
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
  const unique = new Map()
  for (const object of objects) {
    const previous = unique.get(object.type + '\u0000' + object.name)
    if (previous && JSON.stringify(previous) !== JSON.stringify(object)) {
      fail('conflicting schema definitions for ' + object.type + ':' + object.name)
    }
    unique.set(object.type + '\u0000' + object.name, object)
  }
  return [...unique.values()]
}

function migrationNames(input) {
  return [...new Set(collectObjects(input)
    .filter((row) => Object.keys(row).length === 1 &&
      typeof row.name === 'string' && row.name.trim() === row.name && row.name.length > 0)
    .map((row) => row.name))].sort()
}

function migrationTablePresent(objects) {
  return objects.some((object) => object.type === 'table' && object.name === 'd1_migrations')
}

function resolveMigrationState(objects, rawMigrationState) {
  const tablePresent = migrationTablePresent(objects)
  const wasSkipped = typeof rawMigrationState?.querySkipped === 'string'
  if (tablePresent && wasSkipped) fail('d1_migrations exists but the read-only history query was skipped')
  const names = migrationNames(rawMigrationState)
  if (!tablePresent && names.length > 0) fail('migration names were returned when d1_migrations is absent')
  if (!tablePresent && !wasSkipped) fail('migration history state is missing for a database without d1_migrations')
  return { tablePresent, names }
}

function writeReport(outputPath, report) {
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), JSON.stringify(report, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    })
  }
  return report
}

/**
 * Return APPLY only for a clean target schema. An already-applied migration
 * proceeds to postflight validation; partial or colliding schemas fail closed.
 */
export function inspectD1_04OrderMigrationPreflight({ schemaSnapshot, migrationState }) {
  const objects = schemaObjects(schemaSnapshot)
  const state = resolveMigrationState(objects, migrationState)
  if (state.names.includes(ORDER_MIGRATION_ID)) {
    return {
      result: 'PREFLIGHT_PASS_ALREADY_APPLIED',
      action: 'VERIFY_ONLY',
      binding: 'D1_04',
      databaseUuid: ADMITTED_D1_04_UUID,
      migrationId: ORDER_MIGRATION_ID,
      existingObjectNames: objects.map((object) => object.name),
      writesPerformed: false,
      deploymentPerformed: false,
    }
  }

  const collisions = objects
    .filter((object) => TARGET_OBJECT_NAMES.has(object.name))
    .map((object) => object.type + ':' + object.name)
  if (collisions.length > 0) {
    fail('target commerce objects already exist while migration history does not record ' +
      ORDER_MIGRATION_ID + ': ' + collisions.join(', '))
  }

  return {
    result: 'PREFLIGHT_PASS_CLEAN_TARGET',
    action: 'APPLY',
    binding: 'D1_04',
    databaseUuid: ADMITTED_D1_04_UUID,
    migrationId: ORDER_MIGRATION_ID,
    migrationTablePresent: state.tablePresent,
    existingObjectNames: objects.map((object) => object.name),
    writesPerformed: false,
    deploymentPerformed: false,
  }
}

function tableColumns(input, tableName) {
  const columns = collectObjects(input)
    .filter((row) => Number.isInteger(row.cid) && typeof row.name === 'string' && typeof row.type === 'string')
    .map((row) => ({ cid: row.cid, name: row.name, type: row.type.toUpperCase(), notnull: Number(row.notnull ?? 0), pk: Number(row.pk ?? 0) }))
    .sort((a, b) => a.cid - b.cid)
  if (columns.length === 0) fail('remote PRAGMA table_info returned no columns for ' + tableName)
  return columns
}

/**
 * Admit postflight only when migration history, exact table columns, all named
 * indexes/triggers, and every pre-existing schema definition are preserved.
 */
export function verifyD1_04OrderMigrationPostflight({
  preflightSchema,
  postflightSchema,
  migrationState,
  ordersTableInfo,
  orderLinesTableInfo,
  idempotencyTableInfo,
}) {
  const before = schemaObjects(preflightSchema)
  const after = schemaObjects(postflightSchema)
  const state = resolveMigrationState(after, migrationState)
  if (!state.names.includes(ORDER_MIGRATION_ID)) {
    fail('d1_migrations does not contain ' + ORDER_MIGRATION_ID)
  }

  const present = new Map(after.map((object) => [object.type + '\u0000' + object.name, object]))
  for (const tableName of Object.keys(REQUIRED_COLUMNS)) {
    const table = present.get('table\u0000' + tableName)
    if (!table || table.tableName !== tableName || typeof table.sql !== 'string' || table.sql.length === 0) {
      fail('missing or invalid target table definition: ' + tableName)
    }
  }

  const tableInfoByName = {
    orders: ordersTableInfo,
    order_lines: orderLinesTableInfo,
    order_create_idempotency: idempotencyTableInfo,
  }
  for (const [tableName, expectedColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = tableColumns(tableInfoByName[tableName], tableName)
    const actualShape = actual.map((column) => [column.name, column.type, column.notnull])
    const expectedShape = expectedColumns.map((column) => [column[0], column[1], column[2]])
    if (JSON.stringify(actualShape) !== JSON.stringify(expectedShape)) {
      fail('remote column layout differs from the reviewed migration for ' + tableName +
        '; expected ' + JSON.stringify(expectedShape) + ', received ' + JSON.stringify(actualShape))
    }
    const actualPrimaryKeys = actual.filter((column) => column.pk === 1).map((column) => column.name)
    const expectedPrimaryKeys = expectedColumns.filter((column) => column[3] === 1).map((column) => column[0])
    if (JSON.stringify(actualPrimaryKeys) !== JSON.stringify(expectedPrimaryKeys)) {
      fail('remote primary-key layout differs from the reviewed migration for ' + tableName)
    }
  }

  const missingIndexes = Object.entries(REQUIRED_INDEXES).flatMap(([tableName, names]) =>
    names.filter((name) => {
      const object = present.get('index\u0000' + name)
      return !object || object.tableName !== tableName || typeof object.sql !== 'string' || object.sql.length === 0
    }))
  if (missingIndexes.length > 0) fail('required index definitions missing: ' + missingIndexes.join(', '))

  const missingTriggers = Object.entries(REQUIRED_TRIGGERS).flatMap(([tableName, names]) =>
    names.filter((name) => {
      const object = present.get('trigger\u0000' + name)
      return !object || object.tableName !== tableName || typeof object.sql !== 'string' || object.sql.length === 0
    }))
  if (missingTriggers.length > 0) fail('required trigger definitions missing: ' + missingTriggers.join(', '))

  const afterByKey = new Map(after.map((object) => [object.type + '\u0000' + object.name, object]))
  for (const oldObject of before) {
    const key = oldObject.type + '\u0000' + oldObject.name
    const newObject = afterByKey.get(key)
    if (!newObject || JSON.stringify(newObject) !== JSON.stringify(oldObject)) {
      fail('pre-existing schema object was removed or changed: ' + oldObject.type + ':' + oldObject.name)
    }
  }

  const beforeKeys = new Set(before.map((object) => object.type + '\u0000' + object.name))
  const allowedNewNames = new Set([...TARGET_OBJECT_NAMES, 'd1_migrations'])
  const unexpectedNew = after.filter((object) =>
    !beforeKeys.has(object.type + '\u0000' + object.name) && !allowedNewNames.has(object.name))
  if (unexpectedNew.length > 0) {
    fail('migration introduced unexpected schema objects: ' +
      unexpectedNew.map((object) => object.type + ':' + object.name).join(', '))
  }

  return {
    result: 'POSTFLIGHT_PASS',
    binding: 'D1_04',
    databaseUuid: ADMITTED_D1_04_UUID,
    migrationId: ORDER_MIGRATION_ID,
    appliedMigrations: state.names,
    verifiedTables: Object.keys(REQUIRED_COLUMNS),
    verifiedIndexes: Object.values(REQUIRED_INDEXES).flat(),
    verifiedTriggers: Object.values(REQUIRED_TRIGGERS).flat(),
    baselineSchemaPreserved: true,
    databaseRowsExported: false,
    deploymentPerformed: false,
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
}

function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'has-migration-table') {
    if (args.length !== 1) throw new Error('Usage: verify-d1-04-order-migration.mjs has-migration-table <schema-objects.json>')
    console.log(String(migrationTablePresent(schemaObjects(readJson(args[0])))))
    return
  }
  if (mode === 'preflight') {
    if (args.length !== 3) throw new Error('Usage: verify-d1-04-order-migration.mjs preflight <schema-objects.json> <migration-state.json> <output.json>')
    const report = inspectD1_04OrderMigrationPreflight({
      schemaSnapshot: readJson(args[0]),
      migrationState: readJson(args[1]),
    })
    writeReport(args[2], report)
    console.log(JSON.stringify(report, null, 2))
    return
  }
  if (mode === 'postflight') {
    if (args.length !== 7) throw new Error('Usage: verify-d1-04-order-migration.mjs postflight <preflight-schema.json> <postflight-schema.json> <migration-state.json> <orders-info.json> <order-lines-info.json> <idempotency-info.json> <output.json>')
    const report = verifyD1_04OrderMigrationPostflight({
      preflightSchema: readJson(args[0]),
      postflightSchema: readJson(args[1]),
      migrationState: readJson(args[2]),
      ordersTableInfo: readJson(args[3]),
      orderLinesTableInfo: readJson(args[4]),
      idempotencyTableInfo: readJson(args[5]),
    })
    writeReport(args[6], report)
    console.log(JSON.stringify(report, null, 2))
    return
  }
  throw new Error('Expected mode: has-migration-table, preflight, or postflight')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
