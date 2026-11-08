#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const workerRoot = path.resolve(path.dirname(scriptPath), '../..')
const repositoryRoot = path.resolve(workerRoot, '../..')
const contractPath = 'contracts/database/neon-d1-04-w07-saved-methods-mandates-schema.v1.json'
const templatePath = 'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-saved-methods-mandates-postgres.sql'
const outputPath = 'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0002_w07_d1_04_saved_methods_mandates.sql'
const expectedTables = ["saved_payment_methods","payment_mandates"]
const expectedIndexes = ["ix_saved_payment_methods_customer_created","ux_payment_mandates_provider_mandate_id","ix_payment_mandates_customer_status_created","ix_payment_mandates_method_status"]
const expectedTriggers = ["saved_payment_methods_require_succeeded_payment","saved_payment_methods_customer_binding_guard","saved_payment_methods_identity_immutable","saved_payment_methods_retained","payment_mandates_require_saved_method","payment_mandates_start_pending","payment_mandates_identity_immutable","payment_mandates_version_guard","payment_mandates_transition_guard","payment_mandates_provider_id_immutable","payment_mandates_provider_timestamp_monotonic","payment_mandates_retained"]

function readRequired(relativePath, readSource) {
  const value = readSource(relativePath)
  if (typeof value !== 'string') throw new Error('Missing required W07 D1-04 saved-method/mandate source: ' + relativePath)
  return value
}
function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
function inventory(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]).sort()
}
function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(label + ' source inventory drift: ' + JSON.stringify(actual))
  }
}

export function buildW07D104SavedMethodsMandatesMigration({ readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
} } = {}) {
  const contractText = readRequired(contractPath, readSource)
  const contract = JSON.parse(contractText)
  const sourceSql = readRequired('workers/W07-subscription-commerce/migrations-d1-04/0003_saved_payment_methods_mandates.sql', readSource)
  const persistenceText = readRequired('contracts/persistence/SAVED-PAYMENT-METHOD-D1-04-persistence.v1.json', readSource)
  const baseSchemaText = readRequired('workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql', readSource)
  const baseContractText = readRequired('contracts/database/neon-d1-04-w07-order-payment-schema.v1.json', readSource)
  const ledgerText = readRequired('contracts/database/neon-schema-migration-ledger.v1.json', readSource)
  const ownerBoundaryText = readRequired('contracts/transport/worker-d1-access-boundary.v1.json', readSource)
  const template = readRequired(templatePath, readSource)

  const persistence = JSON.parse(persistenceText)
  const baseContract = JSON.parse(baseContractText)
  const ledger = JSON.parse(ledgerText)
  const ownerBoundary = JSON.parse(ownerBoundaryText)

  if (contract.target?.domainId !== 'D1-04' ||
      contract.target?.databaseName !== 'luckread_finance' ||
      contract.target?.postgresMajor !== 18 ||
      contract.target?.cloudflareD1DatabaseUuid !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' ||
      contract.dependencies?.previousMigrationId !== '0001_w07_d1_04_order_payment_schema') {
    throw new Error('W07 D1-04 saved-method/mandate target or dependency contract drift')
  }
  if (contract.primaryOwner?.worker !== 'W07' ||
      persistence.primaryWorker !== 'W07' ||
      persistence.authoritativeDomain !== 'D1-04' ||
      baseContract.primaryOwner?.worker !== 'W07' ||
      baseContract.target?.databaseName !== 'luckread_finance' ||
      baseContract.schema?.sliceTotals?.orderPayment?.tables !== 6 ||
      !ledger.domainOwners?.['D1-04']?.includes('W07') ||
      ownerBoundary.physicalD1Registry?.['D1-04'] !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' ||
      !ownerBoundary.workers?.W07?.allowedDomains?.includes('D1-04')) {
    throw new Error('W07 D1-04 saved-method/mandate ownership/dependency not admitted')
  }

  const tablePattern = /CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z0-9_]+)/gi
  const indexPattern = /CREATE (?:UNIQUE )?INDEX\s+([A-Za-z0-9_]+)/gi
  const triggerPattern = /CREATE TRIGGER\s+([A-Za-z0-9_]+)/gi
  same(inventory(sourceSql, tablePattern), expectedTables, 'PAY-003 table')
  same(inventory(sourceSql, indexPattern), expectedIndexes, 'PAY-003 index')
  same(inventory(sourceSql, triggerPattern), expectedTriggers, 'PAY-003 trigger')

  if (/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:payment_method_revocation_requests|subscription_renewal_cycles|subscription_renewal_scheduler_state|revenuecat_webhook_events|revenuecat_webhook_event_conflicts|refunds|billing_documents|ledger_entries|entitlements|payment_intents|users|media)\b/i.test(sourceSql)) {
    throw new Error('PAY-003 saved-method/mandate slice contains a deferred or cross-domain table')
  }
  if (sourceSql.includes('CREATE TABLE orders') ||
      sourceSql.includes('CREATE TABLE payments') ||
      sourceSql.includes('CREATE TABLE payment_provider_events')) {
    throw new Error('PAY-003 must extend, not recreate, the prior order/payment schema')
  }
  if (!sourceSql.includes("NEW.status <> 'PENDING_PROVIDER_CONFIRMATION'") ||
      !sourceSql.includes("OLD.status IN ('REVOKED','FAILED','EXPIRED') AND NEW.status = OLD.status") ||
      !sourceSql.includes("NEW.consent_terms_version IS NOT OLD.consent_terms_version")) {
    throw new Error('PAY-003 pending-only, terminal lifecycle or consent immutability source guards are missing')
  }
  if (contract.schema?.totals?.tables !== 2 ||
      contract.schema?.totals?.explicitIndexes !== 4 ||
      contract.schema?.totals?.triggers !== 12 ||
      contract.schema?.totals?.triggerFunctions !== 1 ||
      contract.schema?.totals?.foreignKeys !== 0) {
    throw new Error('PAY-003 schema contract totals drift')
  }

  const hashes = {
    W07_SAVED_METHODS_SOURCE_SHA256: sha256(sourceSql),
    SAVED_METHOD_PERSISTENCE_CONTRACT_SHA256: sha256(persistenceText),
    BASE_ORDER_PAYMENT_SCHEMA_SHA256: sha256(baseSchemaText),
    BASE_ORDER_PAYMENT_CONTRACT_SHA256: sha256(baseContractText),
    D1_04_OWNER_LEDGER_CONTRACT_SHA256: sha256(ledgerText),
    D1_04_OWNER_BOUNDARY_CONTRACT_SHA256: sha256(ownerBoundaryText),
  }
  let migration = template
  for (const [name, value] of Object.entries(hashes)) migration = migration.replaceAll('{{' + name + '}}', value)
  if (/\{\{[A-Z0-9_]+\}\}/.test(migration)) throw new Error('Unresolved W07 D1-04 saved-method/mandate checksum placeholder')
  return { migration, hashes, contract }
}

function run() {
  const result = buildW07D104SavedMethodsMandatesMigration()
  const outputPathAbsolute = path.join(repositoryRoot, outputPath)
  const write = process.argv.includes('--write')
  const actual = (() => { try { return readFileSync(outputPathAbsolute,'utf8') } catch { return null } })()
  if (write) {
    writeFileSync(outputPathAbsolute,result.migration)
    process.stdout.write('NEON_D1_04_W07_SAVED_METHODS_MANDATES_MIGRATION_WRITTEN ' + JSON.stringify({
      outputPath,hashes:result.hashes,bytes:Buffer.byteLength(result.migration)
    }) + '\n')
    return
  }
  if (actual !== result.migration) throw new Error('Committed W07 D1-04 saved-method/mandate PostgreSQL migration drift; run generator with --write and review the diff')
  process.stdout.write('NEON_D1_04_W07_SAVED_METHODS_MANDATES_MIGRATION_CURRENT ' + JSON.stringify({
    outputPath,hashes:result.hashes,bytes:Buffer.byteLength(result.migration),
    totals:result.contract.schema.totals,remoteConnectionAttempted:false,remoteDdlExecuted:false
  }) + '\n')
}
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try { run() } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
