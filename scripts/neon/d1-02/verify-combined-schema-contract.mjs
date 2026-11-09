import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd()
const fail = (message) => { throw new Error('D1-02 combined schema contract: ' + message) }
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))
const readArtifact = (file) => readFileSync(path.join(root, file), 'utf8')
const capture = (sql, regex) => [...sql.matchAll(regex)].map((match) => match[1]).sort()

export function verifyCombinedSchemaContract({ contract, inventory, loadArtifact }) {
  const target = contract?.target
  if (target?.domainId !== 'D1-02' || target?.databaseName !== 'luckreadpro' ||
      target?.databaseUuid !== '6c342634-97f6-4248-9f4a-85772af4f22c' ||
      target?.postgresMajor !== 18 || target?.businessDataImport !== false ||
      target?.productionCutoverAuthorized !== false) fail('target must remain D1-02 luckreadpro / PostgreSQL 18 / schema-only')
  if (inventory?.target?.domainId !== 'D1-02' || inventory?.target?.databaseName !== target.databaseName ||
      inventory?.target?.databaseUuid !== target.databaseUuid || inventory?.target?.postgresMajor !== 18 ||
      inventory?.target?.businessDataImport !== false || inventory?.target?.productionCutoverAuthorized !== false) {
    fail('combined target diverges from frozen D1-02 source inventory')
  }
  const correction = contract.correctiveMigration ?? {}
  if (correction.migrationId !== 'd1-02-w03-content-snowflake-timestamp-bigint-v1' ||
      correction.ownerWorker !== 'W03' ||
      correction.artifactPath !== 'workers/W03-content/src/neon-postgres-migrations/0002_w03_d1_02_content_snowflake_timestamp_bigint.sql' ||
      correction.table !== 'content_id_snowflake_state' ||
      correction.column !== 'last_timestamp_ms' ||
      correction.previousPostgresType !== 'integer (signed 32-bit)' ||
      correction.targetPostgresType !== 'bigint (signed 64-bit)' ||
      correction.executionMode !== 'FORWARD_ONLY_ALTER_COLUMN' ||
      correction.rewritesExistingRows !== false ||
      correction.changesSnowflakeIDs !== false ||
      correction.createsTables !== 0 ||
      correction.businessDataImport !== false ||
      correction.productionCutoverAuthorized !== false ||
      correction.remoteApplyReady !== false) {
    fail('W03 Snowflake millisecond corrective migration contract or safety state drift')
  }
  const correctionSql = loadArtifact(correction.artifactPath)
  if (typeof correctionSql !== 'string' ||
      !/^BEGIN;\s*$/m.test(correctionSql) ||
      !/^COMMIT;\s*$/m.test(correctionSql) ||
      !/ALTER TABLE public\.content_id_snowflake_state\s+ALTER COLUMN last_timestamp_ms TYPE BIGINT/i.test(correctionSql) ||
      /\b(?:DROP|TRUNCATE)\s+TABLE\b|\bDELETE\s+FROM\b|\bUPDATE\s+contents\b/i.test(correctionSql)) {
    fail('W03 corrective migration must be a transaction-wrapped forward-only BIGINT column alteration')
  }

  const owners = contract.owners ?? []
  if (JSON.stringify(owners.map((item) => item.worker).sort()) !== JSON.stringify(['W03', 'W05'])) {
    fail('combined schema must include exactly W03 and W05')
  }
  const excluded = contract.excludedBindings ?? []
  if (excluded.length !== 1 || excluded[0].worker !== 'W05' || excluded[0].binding !== 'D1_03' ||
      excluded[0].logicalDomain !== 'D1-03' || excluded[0].databaseName !== 'secondary' ||
      excluded[0].databaseUuid !== 'bda1d247-a371-4244-91ae-aef96034db7f') {
    fail('W05 D1-03 governance binding must remain explicitly excluded')
  }

  const totals = { owners: owners.length, migrationSources: 0, tables: 0, explicitIndexes: 0, triggers: 0, triggerFunctions: 0 }
  const objectNames = { tables: [], explicitIndexes: [], triggers: [], triggerFunctions: [] }
  const ownerArtifacts = []
  for (const owner of owners) {
    const source = inventory.owners?.find((item) => item.worker === owner.worker)
    if (!source || source.migrationDirectory !== owner.migrationDirectory ||
        source.sqlMigrations?.length !== owner.migrationCount ||
        owner.migrationCount !== 15) fail(owner.worker + ' migration source inventory drift')
    const included = source.physicalBindings?.filter((item) => item.included === true) ?? []
    if (included.length !== 1 || included[0].binding !== owner.binding ||
        included[0].logicalDomain !== 'D1-02' || included[0].databaseName !== target.databaseName ||
        included[0].databaseUuid !== target.databaseUuid) fail(owner.worker + ' binding must resolve only to D1-02')
    if (owner.worker === 'W05' && source.physicalBindings?.find((item) => item.binding === 'D1_03')?.included !== false) {
      fail('W05 DB only; W05 D1_03 must remain excluded')
    }

    const sql = loadArtifact(owner.artifactPath)
    if (typeof sql !== 'string') fail('missing owner artifact: ' + owner.artifactPath)
    const actual = {
      tables: capture(sql, /^CREATE TABLE ([a-z_][a-z0-9_]*)/gim),
      explicitIndexes: capture(sql, /^CREATE (?:UNIQUE )?INDEX ([a-z_][a-z0-9_]*)/gim),
      triggers: capture(sql, /^CREATE TRIGGER ([a-z_][a-z0-9_]*)/gim),
      triggerFunctions: capture(sql, /^CREATE(?: OR REPLACE)? FUNCTION ([a-z_][a-z0-9_]*)/gim),
    }
    for (const key of Object.keys(actual)) {
      if (actual[key].length !== owner.expected[key]) fail(owner.worker + ' ' + key + ' count drift')
      objectNames[key].push(...actual[key])
      totals[key] += actual[key].length
    }

    const ddl = sql.replace(/^\s*--.*$/gm, '')
    if (/\bFOREIGN\s+KEY\b|\bREFERENCES\s+[a-z_]/i.test(ddl)) fail(owner.worker + ' artifact introduces an unapproved foreign key')
    if (/\b(?:PRAGMA|AUTOINCREMENT|strftime|julianday|GLOB|json_valid|json_extract|json_object|randomblob)\b|\bINSERT\s+OR\s+IGNORE\b/i.test(ddl)) {
      fail(owner.worker + ' artifact contains SQLite-only syntax')
    }
    if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?notification_push_endpoints\b/i.test(ddl) ||
        /bda1d247-a371-4244-91ae-aef96034db7f|notification_push_endpoints/i.test(ddl)) {
      fail('D1-03/W09 endpoint schema must not appear in D1-02 artifacts')
    }

    totals.migrationSources += owner.migrationCount
    ownerArtifacts.push({
      worker: owner.worker, path: owner.artifactPath,
      sha256: createHash('sha256').update(sql).digest('hex'),
      migrationCount: owner.migrationCount, ...actual,
    })
  }

  for (const key of Object.keys(objectNames)) {
    if (new Set(objectNames[key]).size !== objectNames[key].length) fail('cross-owner duplicate ' + key + ' names')
  }
  const declared = contract.combined ?? {}
  for (const key of ['owners', 'migrationSources', 'tables', 'explicitIndexes', 'triggers', 'triggerFunctions']) {
    if (totals[key] !== declared[key]) fail('combined ' + key + ' total mismatch: ' + totals[key])
  }

  return {
    reportType: 'NEON_D1_02_COMBINED_SCHEMA_CONTRACT_REPORT',
    domainId: 'D1-02', databaseName: target.databaseName, databaseUuid: target.databaseUuid,
    postgresMajor: 18, ownerArtifacts, totals, excludedBindings: excluded,
    safety: {
      neonConnectionAttempted: false, remoteDdlExecuted: false, cloudflareD1Touched: false,
      d1_03SchemaIncluded: false, businessDataImported: false, runtimeChanged: false,
      productionCutoverAuthorized: false,
    },
  }
}

function run() {
  const report = verifyCombinedSchemaContract({
    contract: readJson('contracts/database/neon-d1-02-combined-schema.v1.json'),
    inventory: readJson('contracts/database/neon-d1-02-schema-sources.v1.json'),
    loadArtifact: readArtifact,
  })
  const index = process.argv.indexOf('--report')
  if (index >= 0) {
    const destination = process.argv[index + 1]
    if (!destination) fail('--report requires a destination')
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
  }
  console.log('NEON_D1_02_COMBINED_SCHEMA_CONTRACT_PASS ' + JSON.stringify(report.totals))
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
