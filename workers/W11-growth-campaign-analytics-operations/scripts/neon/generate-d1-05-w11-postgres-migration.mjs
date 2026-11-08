#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const workerRoot = path.resolve(path.dirname(scriptPath), '../..')
const repositoryRoot = path.resolve(workerRoot, '../..')

const paths = {
  contract: 'contracts/database/neon-d1-05-w11-analytics-schema.v1.json',
  ownerBoundary: 'contracts/transport/d1-05-analytics-owner-boundary.v1.json',
  readme: 'workers/W11-growth-campaign-analytics-operations/README.md',
  wrangler: 'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc',
  template: 'workers/W11-growth-campaign-analytics-operations/scripts/neon/templates/d1-05-w11-analytics-postgres.sql',
  output: 'workers/W11-growth-campaign-analytics-operations/src/neon-postgres-migrations/0001_w11_d1_05_analytics_schema.sql',
}

const expectedTables = [
  'analytics_event_dedupe',
  'analytics_content_hourly',
  'analytics_creator_hourly',
  'analytics_rollup_watermark',
  'analytics_reconciliation_status',
  'analytics_projection_rebuild_state',
]
const expectedIndexes = [
  'analytics_event_dedupe_ingested_at_idx',
  'analytics_event_dedupe_occurred_at_idx',
  'analytics_event_dedupe_hour_start_idx',
  'analytics_event_dedupe_pending_idx',
  'analytics_content_hourly_content_time_idx',
  'analytics_content_hourly_content_id_time_idx',
  'analytics_content_hourly_time_idx',
  'analytics_creator_hourly_creator_time_idx',
]

const fail = (message) => { throw new Error(message) }

function readRequired(relativePath, readSource) {
  const value = readSource(relativePath)
  if (typeof value !== 'string') fail('Missing required W11 D1-05 schema source: ' + relativePath)
  return value
}

function parseJson(relativePath, readSource) {
  try {
    return JSON.parse(readRequired(relativePath, readSource))
  } catch (error) {
    fail('Invalid JSON source ' + relativePath + ': ' +
      (error instanceof Error ? error.message : String(error)))
  }
}

function gitBlobSha1(content) {
  const bytes = Buffer.from(content, 'utf8')
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
    .update(bytes)
    .digest('hex')
}

function sameSet(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

function namesIn(sql, pattern) {
  return [...sql.matchAll(pattern)].map((match) => match[1])
}

export function buildD105W11Migration({
  readSource = (relativePath) => {
    try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
  },
} = {}) {
  const contract = parseJson(paths.contract, readSource)
  const ownerBoundary = parseJson(paths.ownerBoundary, readSource)
  const wrangler = parseJson(paths.wrangler, readSource)
  const readme = readRequired(paths.readme, readSource)
  const template = readRequired(paths.template, readSource)

  if (contract.target?.domainId !== 'D1-05' ||
      contract.target?.databaseName !== 'allluck' ||
      contract.target?.postgresMajor !== 18 ||
      contract.target?.primaryWorker !== 'W11' ||
      contract.target?.remoteSchemaApplied !== false ||
      contract.target?.businessDataImport !== false ||
      contract.target?.productionCutoverAuthorized !== false) {
    fail('W11 PostgreSQL schema contract must remain an empty-data D1-05 PostgreSQL 18 staging slice')
  }

  if (contract.admission?.status !==
        'BLOCKED_MISSING_RETENTION_DELETION_AND_CONSENT_PURPOSE_POLICIES' ||
      !Array.isArray(contract.admission?.blockingRequirements) ||
      contract.admission.blockingRequirements.length !== 3 ||
      contract.admission.blockingRequirements.some((item) =>
        item.status !== 'MISSING' || item.evidenceRef !== null)) {
    fail('W11 D1-05 schema cannot be admitted while retention, deletion and consent/purpose evidence is missing')
  }

  if (ownerBoundary.domain !== 'D1-05' ||
      ownerBoundary.primaryWorker !== 'W11' ||
      ownerBoundary.physicalProvisioning?.status !== 'PENDING_ADMISSION' ||
      ownerBoundary.physicalResource?.databaseName !== 'allluck' ||
      !sameSet(ownerBoundary.owners?.W11 ?? [], [
        'ValidatedAnalyticsEvent',
        'AnalyticsDeduplicationKey',
        'ContentViewAggregate',
        'VideoPlayAggregate',
        'ReadingDurationAggregate',
        'SocialMetricProjection',
        'CreatorContentDailyRollup',
        'MetricVersion',
        'RollupWatermark',
        'AnalyticsReconciliationStatus',
        'AnalyticsDashboardReadModel',
      ])) {
    fail('D1-05 canonical boundary must retain W11-exclusive analytics-only ownership and pending admission')
  }

  if (!readme.includes('its analytics persistence binding is D1-05') ||
      !readme.includes('D1-05 is dedicated to derived analytics projections')) {
    fail('W11 README must retain the derived analytics-only boundary')
  }

  const bindings = wrangler.d1_databases ?? []
  if (wrangler.name !== 'luckread-w11' ||
      bindings.length !== 1 ||
      bindings[0]?.binding !== 'D1_05' ||
      bindings[0]?.database_name !== 'allluck' ||
      bindings[0]?.database_id !== '77d82be2-d12e-4a17-b410-9aa7d376bc11' ||
      bindings[0]?.migrations_dir !== 'migrations') {
    fail('W11 must keep its existing single D1_05 binding; this schema slice must not change runtime binding')
  }

  const sourceMigrations = contract.scope?.sourceMigrations
  if (!Array.isArray(sourceMigrations) || sourceMigrations.length !== 4) {
    fail('W11 source inventory must pin exactly the four existing D1-05 migrations')
  }

  for (const source of sourceMigrations) {
    const sql = readRequired(source.path, readSource)
    const actualBlobSha1 = gitBlobSha1(sql)
    if (actualBlobSha1 !== source.gitBlobSha1) {
      fail('W11 D1-05 source migration drift: ' + source.path)
    }
    if (!/W11\s*\/\s*D1-05/i.test(sql.slice(0, 900))) {
      fail('W11 source migration is not explicitly scoped to D1-05: ' + source.path)
    }
    const created = namesIn(sql, /^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_]+)/gim)
    if (created.length === 0 || created.some((name) => !name.startsWith('analytics_'))) {
      fail('W11 D1-05 source includes a non-analytics table: ' + source.path)
    }
  }

  const tableNames = namesIn(template, /^CREATE\s+TABLE\s+([A-Za-z0-9_]+)/gim)
  const indexNames = namesIn(template, /^CREATE\s+INDEX\s+([A-Za-z0-9_]+)/gim)
  if (!sameSet(tableNames, expectedTables) ||
      !sameSet(indexNames, expectedIndexes) ||
      tableNames.length !== 6 ||
      indexNames.length !== 8) {
    fail('W11 PostgreSQL template must contain exactly six analytics tables and eight explicit indexes')
  }

  const uncommented = template.replace(/^--.*$/gm, '')
  if (!/^BEGIN;\s*$/m.test(template) ||
      !/^COMMIT;\s*$/m.test(template) ||
      /\b(?:PRAGMA|AUTOINCREMENT|strftime|julianday|GLOB|json_valid|json_extract|json_object|randomblob)\b/i.test(uncommented) ||
      /\bFOREIGN\s+KEY\b|\bREFERENCES\s+[a-z_]/i.test(uncommented) ||
      /\b(?:campaigns|growth_operations)\b/i.test(uncommented)) {
    fail('W11 artifact must be transactional PostgreSQL SQL without SQLite syntax, cross-domain FKs or invented T22 tables')
  }

  const schemaTables = Object.keys(contract.schema?.tables ?? {})
  if (!sameSet(schemaTables, expectedTables) ||
      contract.schema?.totals?.tables !== 6 ||
      contract.schema?.totals?.explicitIndexes !== 8 ||
      contract.schema?.totals?.foreignKeys !== 0 ||
      contract.schema?.totals?.triggers !== 0 ||
      contract.schema?.totals?.triggerFunctions !== 0) {
    fail('W11 schema contract catalog inventory does not match the generated PostgreSQL artifact')
  }

  if (contract.privacy?.actorIdPersisted !== false ||
      contract.privacy?.visitorIdPersisted !== false ||
      contract.privacy?.sessionIdPersisted !== false ||
      contract.privacy?.creatorIdPersisted !== true ||
      contract.safety?.runtimeBindingsChanged !== false ||
      contract.safety?.remoteNeonDdlExecuted !== false ||
      contract.safety?.cloudflareD1Touched !== false ||
      contract.safety?.businessDataImported !== false ||
      contract.safety?.productionCutoverAuthorized !== false) {
    fail('W11 privacy and no-runtime/no-remote safety declarations must remain explicit')
  }

  return {
    sql: template,
    tableNames: [...tableNames].sort(),
    indexNames: [...indexNames].sort(),
    sourceMigrationCount: sourceMigrations.length,
    admissionStatus: contract.admission.status,
  }
}

function run() {
  const result = buildD105W11Migration()
  const outputPath = path.join(repositoryRoot, paths.output)
  writeFileSync(outputPath, result.sql, 'utf8')
  process.stdout.write('NEON_D1_05_W11_SCHEMA_GENERATED ' + JSON.stringify({
    target: 'allluck',
    postgresMajor: 18,
    tables: result.tableNames.length,
    explicitIndexes: result.indexNames.length,
    sourceMigrations: result.sourceMigrationCount,
    admissionStatus: result.admissionStatus,
    remoteNeonDdlExecuted: false,
    cloudflareD1Touched: false,
  }) + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try { run() } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  }
}
