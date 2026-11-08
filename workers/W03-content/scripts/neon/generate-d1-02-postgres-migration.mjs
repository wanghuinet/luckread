import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd()
const inventoryPath = 'contracts/database/neon-d1-02-schema-sources.v1.json'
const contentContractPath = 'contracts/persistence/CONTENT-ARTICLE-d1-02-persistence.v1.json'
const templatePath = 'workers/W03-content/scripts/neon/templates/d1-02-content-postgres.sql'
const outputPath = 'workers/W03-content/src/neon-postgres-migrations/0001_w03_d1_02_content_schema.sql'

const fail = (message) => { throw new Error('W03 D1-02 PostgreSQL schema drift: ' + message) }
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))

export function buildW03PostgresMigration({ inventory, contentContract, readSource, template }) {
  if (
    inventory?.target?.domainId !== 'D1-02' ||
    inventory?.target?.databaseName !== 'luckreadpro' ||
    inventory?.target?.postgresMajor !== 18 ||
    inventory?.target?.businessDataImport !== false ||
    inventory?.target?.productionCutoverAuthorized !== false
  ) fail('D1-02 target must remain luckreadpro / PostgreSQL 18 / empty-schema only')

  const owner = inventory.owners?.find((item) => item.worker === 'W03')
  if (!owner || owner.migrationDirectory !== 'workers/W03-content/migrations' ||
      !Array.isArray(owner.sqlMigrations) || owner.sqlMigrations.length !== 15) {
    fail('W03 must own exactly the frozen fifteen D1-02 source migrations')
  }
  const included = owner.physicalBindings?.filter((item) => item.included === true) ?? []
  if (included.length !== 1 || included[0].logicalDomain !== 'D1-02' ||
      included[0].databaseName !== 'luckreadpro' ||
      included[0].databaseUuid !== '6c342634-97f6-4248-9f4a-85772af4f22c') {
    fail('W03 D1-02 physical binding no longer matches the admitted database')
  }
  if (contentContract?.authoritativeDomain !== 'D1-02' ||
      contentContract?.primaryWorker !== 'W03' ||
      contentContract?.physicalResource?.databaseName !== 'luckreadpro') {
    fail('Content persistence contract authority/target drift')
  }

  const actualFiles = readdirSync(path.join(root, owner.migrationDirectory))
    .filter((file) => file.endsWith('.sql')).sort()
  const expectedFiles = [...owner.sqlMigrations].sort()
  const missing = expectedFiles.filter((file) => !actualFiles.includes(file))
  const unexpected = actualFiles.filter((file) => !expectedFiles.includes(file))
  if (missing.length || unexpected.length) {
    fail('W03 migration source drift: missing=[' + missing.join(', ') +
      '], unexpected=[' + unexpected.join(', ') + ']')
  }

  const sourceRows = []
  for (const fileName of owner.sqlMigrations) {
    const relativePath = path.posix.join(owner.migrationDirectory, fileName)
    const content = readSource(relativePath)
    if (typeof content !== 'string') fail('Missing source migration: ' + relativePath)
    sourceRows.push({
      path: relativePath,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }

  const sql = template.trim()
  if (!sql.startsWith('-- W03 / D1-02 PostgreSQL 18 schema-only bootstrap.') ||
      !sql.includes('BEGIN;') || !sql.endsWith('COMMIT;')) {
    fail('native PostgreSQL template must be transaction-wrapped and explicitly D1-02 scoped')
  }

  const expectedTables = [
    'contents', 'content_mutation_idempotency', 'content_outbox_events',
    'content_txn_guard', 'content_revisions', 'content_relationships',
    'content_series', 'content_collections', 'content_id_snowflake_state',
  ].sort()
  const actualTables = [...sql.matchAll(/^CREATE TABLE ([a-z_][a-z0-9_]*)/gim)]
    .map((match) => match[1]).sort()
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    fail('native schema must create exactly the nine W03-owned D1-02 tables')
  }

  const expectedIndexes = [
    'contents_state_idx','contents_owner_user_id_idx','contents_creator_id_idx',
    'contents_ip_id_idx','contents_updated_at_idx','contents_state_updated_at_id_idx',
    'contents_owner_updated_at_id_idx','contents_slug_unique_idx','contents_scheduled_due_idx',
    'content_mutation_idempotency_expiry_idx','content_outbox_events_content_idx',
    'content_outbox_events_unpublished_idx','content_revisions_content_created_idx',
    'content_revisions_actor_created_idx','content_revisions_content_slug_idx',
    'content_relationships_active_unique_idx','content_relationships_series_position_unique_idx',
    'content_relationships_collection_position_unique_idx','content_relationships_thread_next_unique_idx',
    'content_relationships_thread_previous_unique_idx','content_relationships_source_created_idx',
    'content_relationships_target_created_idx','content_relationships_series_order_idx',
    'content_relationships_collection_order_idx','content_series_owner_updated_idx',
    'content_series_state_updated_idx','content_collections_owner_updated_idx',
    'content_collections_state_updated_idx',
  ]
  const actualIndexes = [...sql.matchAll(/^CREATE (?:UNIQUE )?INDEX ([a-z_][a-z0-9_]*)/gim)]
    .map((match) => match[1])
  if (JSON.stringify([...actualIndexes].sort()) !== JSON.stringify([...expectedIndexes].sort())) {
    fail('native schema index set does not match the final D1 source migration set')
  }

  const expectedTriggers = [
    'contents_after_insert_outbox','contents_after_update_outbox',
    'content_relationships_after_insert_outbox','content_relationships_after_update_outbox',
    'content_series_after_insert_outbox','content_series_after_update_outbox',
    'content_collections_after_insert_outbox','content_collections_after_update_outbox',
  ]
  const actualTriggers = [...sql.matchAll(/^CREATE TRIGGER ([a-z_][a-z0-9_]*)/gim)]
    .map((match) => match[1])
  if (JSON.stringify([...actualTriggers].sort()) !== JSON.stringify([...expectedTriggers].sort())) {
    fail('native schema trigger set does not preserve the source outbox trigger authorities')
  }

  for (const token of [
    'gen_random_uuid()', 'json_build_object(', 'content_id_snowflake_state',
    'VALUES (1, -1, 4095)', "DEFAULT 'PUBLIC'", "DEFAULT '[]'",
    "relation_type = 'thread-next'", 'content_relationships_thread_next_unique_idx',
    'content_relationships_thread_previous_unique_idx', 'contents_scheduled_due_idx',
    'contents_slug_unique_idx', 'media_warning TEXT', 'access_mode TEXT',
  ]) {
    if (!sql.includes(token)) fail('native schema is missing required final-state behavior: ' + token)
  }
  if (/\b(?:PRAGMA|AUTOINCREMENT|strftime|julianday|GLOB)\b|\bjson_object\s*\(|\brandomblob\s*\(|\bRAISE\s*\(\s*ABORT/i.test(sql)) {
    fail('PostgreSQL template contains SQLite-only syntax')
  }
  if (/\bFOREIGN\s+KEY\b|\bREFERENCES\b/i.test(sql)) {
    fail('W03 domain references must remain opaque; no foreign keys are admitted')
  }
  if (!/payload_json TEXT NOT NULL/.test(sql) ||
      !/media_refs_json TEXT NOT NULL DEFAULT '\[\]'/.test(sql)) {
    fail('JSON payloads/media references must remain source-compatible TEXT fields')
  }
  if (!/created_at TIMESTAMPTZ NOT NULL/.test(sql) || !/updated_at TIMESTAMPTZ NOT NULL/.test(sql)) {
    fail('D1 ISO-8601 timestamps must map consistently to TIMESTAMPTZ')
  }

  const header = [
    '-- GENERATED FILE. Do not hand-edit.',
    '-- Regenerate with workers/W03-content/scripts/neon/generate-d1-02-postgres-migration.mjs.',
    '-- Template: workers/W03-content/scripts/neon/templates/d1-02-content-postgres.sql.',
    '-- Source authority: W03 / D1-02; current runtime authority remains Cloudflare D1.',
    ''
  ].join('\n')

  return {
    artifact: header + sql + '\n',
    sourceReport: {
      reportType: 'W03_D1_02_POSTGRES_SCHEMA_SOURCE_HASHES',
      sourceOwner: 'W03',
      targetDatabase: 'luckreadpro',
      postgresMajor: 18,
      migrationCount: sourceRows.length,
      sourceMigrations: sourceRows,
      safety: { neonConnectionAttempted: false, remoteDdlExecuted: false,
        productionD1Touched: false, businessDataImported: false, productionCutoverAuthorized: false }
    }
  }
}

function readSource(relativePath) {
  try { return readFileSync(path.join(root, relativePath), 'utf8') } catch { return null }
}

function run() {
  const inventory = readJson(inventoryPath)
  const contentContract = readJson(contentContractPath)
  const template = readFileSync(path.join(root, templatePath), 'utf8')
  const { artifact, sourceReport } = buildW03PostgresMigration({ inventory, contentContract, readSource, template })
  mkdirSync(path.dirname(path.join(root, outputPath)), { recursive: true })
  writeFileSync(path.join(root, outputPath), artifact)
  const reportIndex = process.argv.indexOf('--report')
  if (reportIndex >= 0) {
    const reportPath = process.argv[reportIndex + 1]
    if (!reportPath) fail('--report requires an output path')
    mkdirSync(path.dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(sourceReport, null, 2) + '\n')
  }
  console.log('W03_D1_02_POSTGRES_MIGRATION_GENERATION_PASS')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
