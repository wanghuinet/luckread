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
