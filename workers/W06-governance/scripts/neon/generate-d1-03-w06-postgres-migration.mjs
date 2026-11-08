#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const workerRoot = path.resolve(path.dirname(scriptPath), '../..')
const repositoryRoot = path.resolve(workerRoot, '../..')
const contractPath = 'contracts/database/neon-d1-03-w06-moderation-schema.v1.json'
const templatePath = 'workers/W06-governance/scripts/neon/templates/d1-03-w06-moderation-postgres.sql'
const outputPath = 'workers/W06-governance/src/neon-postgres-migrations/0001_w06_d1_03_moderation_schema.sql'

function readRequired(relativePath, readSource) {
  const value = readSource(relativePath)
  if (typeof value !== 'string') throw new Error(\`Missing required W06 D1-03 schema source: \${relativePath}\`)
  return value
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function tableExists(source, tableName) {
  return source.toLowerCase().includes(\`create table if not exists \${tableName.toLowerCase()}\`)
}

export function buildD103W06Migration({ readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
} } = {}) {
  const contractText = readRequired(contractPath, readSource)
  const contract = JSON.parse(contractText)
  const queueSql = readRequired('workers/W06-governance/migrations/0002_moderation_queue_foundation.sql', readSource)
  const reportSql = readRequired('workers/W06-governance/migrations/0003_moderation_report_v1.sql', readSource)
  const persistenceText = readRequired('contracts/persistence/MODERATION-QUEUE-FOUNDATION-persistence.v1.json', readSource)
  const caseEntityText = readRequired('contracts/entity/MODERATION-CASE-CONTRACT.v1.json', readSource)
  const decisionEntityText = readRequired('contracts/entity/MODERATION-DECISION-CONTRACT.v1.json', readSource)
  const reportAppealApiText = readRequired('contracts/api/report-appeal.v1.json', readSource)
  const appealsDoc = readRequired('docs/63-MODERATION-APPEALS-SYSTEM-CONTRACT-v1.0.md', readSource)
  const ownerBoundaryText = readRequired('contracts/transport/d1-03-entity-owner-boundary.v1.json', readSource)
  const template = readRequired(templatePath, readSource)

  const persistence = JSON.parse(persistenceText)
  const caseEntity = JSON.parse(caseEntityText)
  const decisionEntity = JSON.parse(decisionEntityText)
  const reportAppealApi = JSON.parse(reportAppealApiText)
  const ownerBoundary = JSON.parse(ownerBoundaryText)

  if (contract.target?.domainId !== 'D1-03' ||
      contract.target?.databaseName !== 'luckread_governance' ||
      contract.target?.postgresMajor !== 18) {
    throw new Error('W06 D1-03 schema contract must target luckread_governance PostgreSQL 18')
  }
  if (contract.primaryOwner?.worker !== 'W06' ||
      !contract.primaryOwner.entities?.includes('ModerationCase') ||
      !contract.primaryOwner.entities?.includes('ModerationDecision') ||
      !contract.primaryOwner.entities?.includes('Report')) {
    throw new Error('W06 must own the admitted ModerationCase, ModerationDecision and Report schemas')
  }
  if (!ownerBoundary.owners?.W06?.includes('ModerationCase') ||
      !ownerBoundary.owners?.W06?.includes('ModerationDecision') ||
      !ownerBoundary.owners?.W06?.includes('Report') ||
      ownerBoundary.crossCutting?.AuditEvent?.owner !== 'W09') {
    throw new Error('D1-03 owner boundary must keep moderation in W06 and AuditEvent in W09')
  }

  const queueTables = [
    'moderation_cases',
    'moderation_decisions',
    'moderation_decision_idempotency',
    'moderation_txn_guard',
    'moderation_enforcement_outbox',
  ]
  const reportTables = ['moderation_reports', 'moderation_report_idempotency']
  for (const table of queueTables) {
    if (!tableExists(queueSql, table)) throw new Error(\`W06 queue source is missing table \${table}\`)
  }
  for (const table of reportTables) {
    if (!tableExists(reportSql, table)) throw new Error(\`W06 report source is missing table \${table}\`)
  }
  if (queueSql.includes('CREATE TABLE IF NOT EXISTS appeals') ||
      queueSql.includes('CREATE TABLE IF NOT EXISTS moderation_appeals') ||
      reportSql.includes('CREATE TABLE IF NOT EXISTS appeals') ||
      reportSql.includes('CREATE TABLE IF NOT EXISTS moderation_appeals')) {
    throw new Error('Appeal persistence is not admitted by the current W06 source migrations; do not invent an Appeal table')
  }
  if (queueSql.includes('CREATE TABLE IF NOT EXISTS audit_events') ||
      reportSql.includes('CREATE TABLE IF NOT EXISTS audit_events')) {
    throw new Error('W06 must not create a duplicate AuditEvent table; W09 is the D1-03 owner')
  }
  if (!persistence.tables?.moderation_cases ||
      !persistence.tables?.moderation_decisions ||
      !persistence.tables?.moderation_decision_idempotency ||
      !persistence.tables?.moderation_txn_guard ||
      !persistence.tables?.moderation_enforcement_outbox) {
    throw new Error('W06 moderation persistence contract no longer matches the admitted queue source tables')
  }
  if (caseEntity.authority?.primaryWorker !== 'W06' ||
      decisionEntity.authority?.primaryWorker !== 'W06') {
    throw new Error('ModerationCase and ModerationDecision entity contracts must retain W06 authority')
  }
  if (!reportAppealApi.operations?.some((op) => op.operationId === 'createReport') ||
      !reportAppealApi.operations?.some((op) => op.operationId === 'createAppeal') ||
      !appealsDoc.includes('IMPLEMENTATION PENDING')) {
    throw new Error('Report/Appeal contract sources changed; explicitly re-admit Appeal persistence before adding its schema')
  }

  const expectedTables = Object.keys(contract.schema?.tables ?? {}).sort()
  const expectedNames = [...queueTables, ...reportTables].sort()
  if (JSON.stringify(expectedTables) !== JSON.stringify(expectedNames)) {
    throw new Error('W06 schema contract table inventory must exactly match the seven admitted physical source tables')
  }
  if (contract.schema?.totals?.tables !== 7 ||
      contract.schema?.totals?.explicitIndexes !== 11 ||
      contract.schema?.totals?.foreignKeys !== 0) {
    throw new Error('W06 schema contract totals must remain 7 tables, 11 explicit indexes and 0 foreign keys')
  }

  const hashes = {
    W06_MODERATION_QUEUE_SQL_SHA256: sha256(queueSql),
    W06_MODERATION_REPORT_SQL_SHA256: sha256(reportSql),
    W06_PERSISTENCE_CONTRACT_SHA256: sha256(persistenceText),
    W06_CASE_ENTITY_CONTRACT_SHA256: sha256(caseEntityText),
    W06_DECISION_ENTITY_CONTRACT_SHA256: sha256(decisionEntityText),
    W06_REPORT_APPEAL_API_SHA256: sha256(reportAppealApiText),
    D1_03_OWNER_BOUNDARY_SHA256: sha256(ownerBoundaryText),
  }
  return { migration: template, hashes, contract }
}

function run() {
  const result = buildD103W06Migration()
  const outputAbsolutePath = path.join(repositoryRoot, outputPath)
  const write = process.argv.includes('--write')
  const actual = (() => {
    try { return readFileSync(outputAbsolutePath, 'utf8') } catch { return null }
  })()

  if (write) {
    writeFileSync(outputAbsolutePath, result.migration)
    process.stdout.write('NEON_D1_03_W06_MIGRATION_WRITTEN ' + JSON.stringify({
      outputPath,
      hashes: result.hashes,
      bytes: Buffer.byteLength(result.migration),
    }) + '\n')
    return
  }
  if (actual !== result.migration) {
    throw new Error('Committed W06 D1-03 PostgreSQL migration drift; run the generator with --write and review the diff')
  }
  process.stdout.write('NEON_D1_03_W06_MIGRATION_CURRENT ' + JSON.stringify({
    outputPath,
    hashes: result.hashes,
    bytes: Buffer.byteLength(result.migration),
    totals: result.contract.schema.totals,
    appealPersistenceAdmitted: false,
    remoteConnectionAttempted: false,
    remoteDdlExecuted: false,
  }) + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try { run() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
