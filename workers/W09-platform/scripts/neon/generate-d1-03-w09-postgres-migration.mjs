#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const workerRoot = path.resolve(path.dirname(scriptPath), '../..')
const repositoryRoot = path.resolve(workerRoot, '../..')
const contractPath = 'contracts/database/neon-d1-03-w09-platform-schema.v1.json'
const templatePath = 'workers/W09-platform/scripts/neon/templates/d1-03-w09-platform-postgres.sql'
const outputPath = 'workers/W09-platform/src/neon-postgres-migrations/0001_w09_d1_03_platform_schema.sql'

function readRequired(relativePath, readSource) {
  const value = readSource(relativePath)
  if (typeof value !== 'string') throw new Error(`Missing required D1-03 W09 schema source: ${relativePath}`)
  return value
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function buildD103W09Migration({ readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
} } = {}) {
  const contract = JSON.parse(readRequired(contractPath, readSource))
  const auditSchemaText = readRequired('contracts/schemas/common/audit-event.json', readSource)
  const legacyAuditSql = readRequired('workers/W06-governance/migrations/0001_audit_event.sql', readSource)
  const pushSql = readRequired('workers/W09-platform/migrations-d1-03/0001_notification_push_endpoints.sql', readSource)
  const pushContractText = readRequired('contracts/persistence/NOTIFY-002-W05-D1-03-PUSH-ENDPOINT-PERSISTENCE.v1.json', readSource)
  const ownerBoundaryText = readRequired('contracts/transport/d1-03-entity-owner-boundary.v1.json', readSource)
  const domainMasterText = readRequired('docs/09-D1-DOMAIN-MASTER-v1.0.md', readSource)
  const template = readRequired(templatePath, readSource)

  const auditSchema = JSON.parse(auditSchemaText)
  const pushContract = JSON.parse(pushContractText)
  const ownerBoundary = JSON.parse(ownerBoundaryText)

  if (contract.target?.domainId !== 'D1-03' ||
      contract.target?.databaseName !== 'luckread_governance' ||
      contract.target?.postgresMajor !== 18) {
    throw new Error('D1-03 W09 schema contract must target luckread_governance PostgreSQL 18')
  }
  if (contract.primaryOwner?.worker !== 'W09' ||
      !contract.primaryOwner.entities?.includes('AuditEvent') ||
      !contract.primaryOwner.entities?.includes('NotificationPushEndpoint')) {
    throw new Error('W09 must own the staged AuditEvent and NotificationPushEndpoint schemas')
  }
  if (auditSchema['x-luckread']?.['authoritative-writer'] !== 'W09' ||
      auditSchema['x-luckread']?.legacyCloudflareD1CompatibilityWriter !== 'W06') {
    throw new Error('AuditEvent schema must distinguish W09 ownership from the retained W06 Cloudflare D1 compatibility writer')
  }
  if (ownerBoundary.crossCutting?.AuditEvent?.owner !== 'W09' ||
      ownerBoundary.scopedDelegations?.NotificationPushEndpoint?.primaryOwner !== 'W09') {
    throw new Error('D1-03 owner boundary must retain W09 primary ownership')
  }
  if (pushContract.authority?.primaryWorker !== 'W09' ||
      pushContract.authority?.domainId !== 'D1-03' ||
      pushContract.persistence?.table !== 'notification_push_endpoints') {
    throw new Error('NOTIFY-002 must retain the W09 D1-03 schema owner')
  }
  if (!domainMasterText.includes('| AuditEvent | W09 |') ||
      !domainMasterText.includes('| NotificationPushEndpoint | W09 |')) {
    throw new Error('Canonical D1 Domain Master must retain W09 ownership')
  }
  if (!legacyAuditSql.includes('CREATE TABLE IF NOT EXISTS audit_events') ||
      !legacyAuditSql.includes('audit_events_immutable_update') ||
      !legacyAuditSql.includes('audit_events_immutable_delete')) {
    throw new Error('Legacy W06 D1 AuditEvent source no longer exposes the expected table and immutability semantics')
  }
  if (!pushSql.includes('CREATE TABLE IF NOT EXISTS notification_push_endpoints') ||
      !pushSql.includes('uq_notification_push_endpoints_provider_token') ||
      !pushSql.includes('ix_notification_push_endpoints_owner_status')) {
    throw new Error('W09 D1 push endpoint source no longer matches the declared table/index contract')
  }

  const hashes = {
    AUDIT_EVENT_SCHEMA_SHA256: sha256(auditSchemaText),
    LEGACY_W06_AUDIT_D1_SHA256: sha256(legacyAuditSql),
    W09_PUSH_ENDPOINT_D1_SHA256: sha256(pushSql),
    NOTIFY_002_CONTRACT_SHA256: sha256(pushContractText),
    D1_03_OWNER_BOUNDARY_SHA256: sha256(ownerBoundaryText),
  }
  let migration = template
  for (const [name, value] of Object.entries(hashes)) {
    migration = migration.replaceAll(`{{${name}}}`, value)
  }
  if (/\{\{[A-Z0-9_]+\}\}/.test(migration)) {
    throw new Error('Unresolved source checksum token in W09 D1-03 PostgreSQL migration')
  }
  return { migration, hashes, contract }
}

function run() {
  const result = buildD103W09Migration()
  const outputAbsolutePath = path.join(repositoryRoot, outputPath)
  const write = process.argv.includes('--write')
  const actual = (() => {
    try { return readFileSync(outputAbsolutePath, 'utf8') } catch { return null }
  })()

  if (write) {
    writeFileSync(outputAbsolutePath, result.migration)
    process.stdout.write('NEON_D1_03_W09_MIGRATION_WRITTEN ' + JSON.stringify({
      outputPath,
      hashes: result.hashes,
      bytes: Buffer.byteLength(result.migration),
    }) + '\n')
    return
  }
  if (actual !== result.migration) {
    throw new Error('Committed W09 D1-03 PostgreSQL migration drift; run the generator with --write and review the diff')
  }
  process.stdout.write('NEON_D1_03_W09_MIGRATION_CURRENT ' + JSON.stringify({
    outputPath,
    hashes: result.hashes,
    bytes: Buffer.byteLength(result.migration),
    totals: result.contract.schema.totals,
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
