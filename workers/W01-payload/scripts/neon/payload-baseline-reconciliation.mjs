export const EXPECTED_W01_PAYLOAD_MIGRATION_NAME =
  '20261107_202531_neon_d1_01_payload_baseline'

export function evaluatePayloadMigrationLedgerRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const actualNames = safeRows.map((row) =>
    typeof row?.name === 'string' ? row.name : null,
  )
  const valid =
    safeRows.length === 1 &&
    actualNames[0] === EXPECTED_W01_PAYLOAD_MIGRATION_NAME

  return {
    valid,
    expectedName: EXPECTED_W01_PAYLOAD_MIGRATION_NAME,
    actualNames,
    rowCount: safeRows.length,
  }
}

/**
 * Compare only the W01 Payload table set.
 *
 * The PostgreSQL database is shared by several Worker owners. Tables not in
 * the committed W01 Payload snapshot are outside this verifier's ownership
 * boundary and must not cause W01 reconciliation to fail.
 */
export function evaluateW01PayloadTableCatalog(expectedTableNames, actualTableNames) {
  const expected = [...new Set(expectedTableNames)].sort()
  const actual = [...new Set(actualTableNames)].sort()
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const missingTables = expected.filter((tableName) => !actualSet.has(tableName))

  return {
    valid: missingTables.length === 0,
    expectedTables: expected,
    missingTables,
    tablesOutsideW01Snapshot: actual.filter((tableName) => !expectedSet.has(tableName)),
  }
}

/**
 * Foreign keys belong to the Worker that owns the referencing/source table.
 * Keep all W01-source foreign keys (including unexpected ones, so they fail
 * exact comparison) and ignore constraints declared by other Worker tables.
 */
export function evaluateW01PayloadForeignKeyCatalog(
  expectedForeignKeys,
  actualForeignKeys,
  w01TableNames,
) {
  const w01Tables = new Set(w01TableNames)
  const byConstraintName = (left, right) =>
    left.constraintName.localeCompare(right.constraintName)
  const expected = expectedForeignKeys
    .filter((foreignKey) => w01Tables.has(foreignKey.tableName))
    .sort(byConstraintName)
  const actual = actualForeignKeys
    .filter((foreignKey) => w01Tables.has(foreignKey.tableName))
    .sort(byConstraintName)

  return {
    valid: JSON.stringify(actual) === JSON.stringify(expected),
    expected,
    actual,
    ignoredForeignKeyCount: actualForeignKeys.length - actual.length,
  }
}
