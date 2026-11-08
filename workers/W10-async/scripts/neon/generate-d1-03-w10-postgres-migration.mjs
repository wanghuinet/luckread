#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const workerRoot = path.resolve(path.dirname(scriptPath), '../..')
const repositoryRoot = path.resolve(workerRoot, '../..')
const contractPath = 'contracts/database/neon-d1-03-w10-execution-schema.v1.json'
const ownerBoundaryPath = 'contracts/transport/d1-03-entity-owner-boundary.v1.json'
const d1MigrationPath = 'workers/W09-platform/migrations-d1-03/0002_w10_async_execution_state.sql'
const templatePath = 'workers/W10-async/scripts/neon/templates/d1-03-w10-execution-postgres.sql'
const outputPath = 'workers/W10-async/src/neon-postgres-migrations/0001_w10_d1_03_async_execution.sql'
const expectedTables = [
  'jobs',
  'job_retries',
  'execution_dead_letters',
  'execution_inbox',
  'execution_outbox',
  'operational_idempotency',
]
const sourcePaths = [
  'docs/163-EVENT-SEMANTICS-DELIVERY-ORDERING-REPLAY-DLQ-CONTRACT-v1.0.md',
  'docs/165-UNIFIED-ASYNC-OPERATION-CONTRACT-v1.0.md',
  'workers/W10-async/README.md',
  'workers/W10-async/src/event-envelope.ts',
  'workers/W10-async/src/retry-policy.ts',
  'workers/W10-async/src/canonical-json-idempotency.ts',
]

function readRequired(relativePath, readSource) {
  const value = readSource(relativePath)
  if (typeof value !== 'string') throw new Error('Missing required W10 schema source: ' + relativePath)
  return value
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function buildD103W10Migration({
  readSource = (relativePath) => {
    try {
      return readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
    } catch {
      return null
    }
  },
} = {}) {
  const contractText = readRequired(contractPath, readSource)
  const contract = JSON.parse(contractText)
  const ownerBoundaryText = readRequired(ownerBoundaryPath, readSource)
  const ownerBoundary = JSON.parse(ownerBoundaryText)
  const d1Migration = readRequired(d1MigrationPath, readSource)
  const template = readRequired(templatePath, readSource)
  const w10Config = JSON.parse(readRequired('workers/W10-async/wrangler.jsonc', readSource))
  const w09Config = JSON.parse(readRequired('workers/W09-platform/wrangler.d1-03-migrations.jsonc', readSource))

  if (contract.target?.domainId !== 'D1-03' ||
      contract.target?.databaseName !== 'luckread_governance' ||
      contract.target?.postgresMajor !== 18 ||
      contract.primaryOwner?.worker !== 'W10') {
    throw new Error('W10 schema contract must target D1-03 luckread_governance PostgreSQL 18')
  }
  const declaredEntities = contract.primaryOwner?.entities ?? []
  const expectedEntities = [
    'Job', 'Retry', 'DLQ', 'ExecutionInbox', 'ExecutionOutbox', 'OperationalIdempotency',
  ]
  if (JSON.stringify(declaredEntities) !== JSON.stringify(expectedEntities) ||
      JSON.stringify(ownerBoundary.owners?.W10) !== JSON.stringify(expectedEntities)) {
    throw new Error('W10 six-entity primary-owner inventory must match the frozen D1-03 owner boundary')
  }
  if (contract.schema?.totals?.tables !== 6 ||
      contract.schema?.totals?.explicitIndexes !== 7 ||
      contract.schema?.totals?.foreignKeys !== 2) {
    throw new Error('W10 schema totals must remain 6 tables, 7 explicit indexes and 2 same-owner foreign keys')
  }
  if (w10Config.name !== 'luckread-w10' ||
      (w10Config.d1_databases ?? []).length !== 0 ||
      w10Config.queues !== undefined ||
      !w10Config.workflows?.some((workflow) => workflow.binding === 'MEMBERSHIP_RENEWAL_WORKFLOW')) {
    throw new Error('This source-admission slice must not add W10 D1/Queue bindings or change the existing Workflow boundary')
  }
  if (w09Config.name !== 'luckread-w09' ||
      w09Config.d1_databases?.length !== 1 ||
      w09Config.d1_databases[0]?.binding !== 'D1_03' ||
      w09Config.d1_databases[0]?.database_id !== 'bda1d247-a371-4244-91ae-aef96034db7f' ||
      w09Config.d1_databases[0]?.migrations_dir !== 'migrations-d1-03') {
    throw new Error('W09 must remain the sole D1-03 Wrangler migration-config owner')
  }

  const actualTables = [...d1Migration.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/gi)]
    .map((match) => match[1])
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    throw new Error('W10 D1 migration must define exactly the six admitted execution tables')
  }
  for (const table of expectedTables) {
    if (!contract.schema?.tables?.[table]) throw new Error('W10 schema contract is missing table ' + table)
    if (!template.includes('CREATE TABLE ' + table + ' (')) {
      throw new Error('W10 PostgreSQL translation is missing table ' + table)
    }
  }
  if (/CREATE TABLE IF NOT EXISTS (audit_events|notification_push_endpoints|moderation_cases|moderation_reports)\b/i.test(d1Migration)) {
    throw new Error('W10 source must not create W06/W09-owned D1-03 entities')
  }
  if (/\b(payload_json|raw_payload|private_message|payment_credential|access_token)\b/i.test(d1Migration)) {
    throw new Error('W10 execution metadata must not persist raw/sensitive payload columns')
  }
  for (const sourcePath of sourcePaths) {
    readRequired(sourcePath, readSource)
  }

  const hashes = {
    d1MigrationSha256: digest(d1Migration),
    ownerBoundarySha256: digest(ownerBoundaryText),
    schemaContractSha256: digest(contractText),
  }
  return { migration: template, hashes, contract }
}

function run() {
  const result = buildD103W10Migration()
  const target = path.join(repositoryRoot, outputPath)
  const write = process.argv.includes('--write')
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : null

  if (write) {
    writeFileSync(target, result.migration)
    process.stdout.write('NEON_D1_03_W10_MIGRATION_WRITTEN ' + JSON.stringify({
      outputPath,
      hashes: result.hashes,
      bytes: Buffer.byteLength(result.migration),
    }) + '\n')
    return
  }
  if (existing !== result.migration) {
    throw new Error('Committed W10 D1-03 PostgreSQL migration drift; run the generator with --write and review the diff')
  }
  process.stdout.write('NEON_D1_03_W10_MIGRATION_CURRENT ' + JSON.stringify({
    outputPath,
    hashes: result.hashes,
    bytes: Buffer.byteLength(result.migration),
    totals: result.contract.schema.totals,
    runtimeBindingAdded: false,
    remoteDdlExecuted: false,
  }) + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
