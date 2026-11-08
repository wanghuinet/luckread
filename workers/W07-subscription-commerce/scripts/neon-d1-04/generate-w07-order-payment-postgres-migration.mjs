#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const workerRoot = path.resolve(path.dirname(scriptPath), '../..')
const repositoryRoot = path.resolve(workerRoot, '../..')
const contractPath = 'contracts/database/neon-d1-04-w07-order-payment-schema.v1.json'
const templatePath = 'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-order-payment-postgres.sql'
const outputPath = 'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql'
const expectedTables = ["orders","order_lines","order_create_idempotency","payments","payment_provider_events","payment_provider_event_conflicts"]
const expectedIndexes = ["ix_orders_customer_created_order","ix_orders_status_created_order","ix_order_lines_order_id","ix_order_lines_item_ref_version","ix_order_create_idempotency_customer_created","ix_order_create_idempotency_expiration","ix_payments_customer_created_payment","ix_payments_order_created_payment","ix_payments_status_updated_payment","ux_payments_single_live_or_successful_per_order","ix_payment_provider_events_state_received","ix_payment_provider_events_payment_received","ix_payment_provider_event_conflicts_state_last_seen","ix_payment_provider_event_conflicts_identity"]
const expectedTriggers = ["orders_commercial_snapshot_immutable","orders_version_must_advance","orders_status_transition_guard","orders_retained","order_lines_require_order","order_lines_immutable_update","order_lines_retained","orders_require_matching_completed_idempotency","order_create_idempotency_identity_immutable","order_create_idempotency_terminal_immutable","payments_require_payable_order","payments_snapshot_immutable","payments_version_must_advance","payments_terminal_status_guard","payments_provider_timestamp_monotonic","payments_retained","payment_provider_events_identity_immutable","payment_provider_events_terminal_immutable","payment_provider_events_retained","payment_provider_event_conflicts_reference_first_receipt","payment_provider_event_conflicts_identity_immutable","payment_provider_event_conflicts_version_guard","payment_provider_event_conflicts_resolved_immutable","payment_provider_event_conflicts_retained"]

function readRequired(relativePath, readSource) {
  const value = readSource(relativePath)
  if (typeof value !== 'string') throw new Error('Missing required W07 D1-04 schema source: ' + relativePath)
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

export function buildW07D104OrderPaymentMigration({ readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
} } = {}) {
  const contractText = readRequired(contractPath, readSource)
  const contract = JSON.parse(contractText)
  const orderSql = readRequired('workers/W07-subscription-commerce/migrations-d1-04/0001_order_commerce.sql', readSource)
  const paymentSql = readRequired('workers/W07-subscription-commerce/migrations-d1-04/0002_payment_provider_events.sql', readSource)
  const orderContractText = readRequired('contracts/persistence/ORDER-D1-04-persistence.v1.json', readSource)
  const paymentContractText = readRequired('contracts/persistence/PAYMENT-D1-04-persistence.v1.json', readSource)
  const orderStateText = readRequired('contracts/state-machines/order.json', readSource)
  const paymentStateText = readRequired('contracts/state-machines/payment.json', readSource)
  const ledgerContractText = readRequired('contracts/database/neon-schema-migration-ledger.v1.json', readSource)
  const ownerBoundaryText = readRequired('contracts/transport/worker-d1-access-boundary.v1.json', readSource)
  const template = readRequired(templatePath, readSource)

  const orderContract = JSON.parse(orderContractText)
  const paymentContract = JSON.parse(paymentContractText)
  const ledgerContract = JSON.parse(ledgerContractText)
  const ownerBoundary = JSON.parse(ownerBoundaryText)

  if (contract.target?.domainId !== 'D1-04' ||
      contract.target?.databaseName !== 'luckread_finance' ||
      contract.target?.postgresMajor !== 18 ||
      contract.target?.cloudflareD1DatabaseUuid !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736') {
    throw new Error('W07 D1-04 schema contract target/database UUID drift')
  }
  if (contract.primaryOwner?.worker !== 'W07' ||
      orderContract.primaryWorker !== 'W07' ||
      orderContract.authoritativeDomain !== 'D1-04' ||
      paymentContract.primaryWorker !== 'W07' ||
      paymentContract.authoritativeDomain !== 'D1-04' ||
      !ledgerContract.domainOwners?.['D1-04']?.includes('W07') ||
      ownerBoundary.physicalD1Registry?.['D1-04'] !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' ||
      !ownerBoundary.workers?.W07?.allowedDomains?.includes('D1-04')) {
    throw new Error('W07 D1-04 owner boundary is not admitted by the canonical contracts')
  }

  const tablePattern = /CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z0-9_]+)/gi
  const indexPattern = /CREATE (?:UNIQUE )?INDEX\s+([A-Za-z0-9_]+)/gi
  const triggerPattern = /CREATE TRIGGER\s+([A-Za-z0-9_]+)/gi
  const orderTables = inventory(orderSql, tablePattern)
  const paymentTables = inventory(paymentSql, tablePattern)
  same(orderTables, ['orders','order_lines','order_create_idempotency'], 'PAY-002 table')
  same(paymentTables, ['payments','payment_provider_events','payment_provider_event_conflicts'], 'PAY-001 table')
  same(inventory(orderSql, indexPattern), expectedIndexes.slice(0,6), 'PAY-002 index')
  same(inventory(paymentSql, indexPattern), expectedIndexes.slice(6), 'PAY-001 index')
  same(inventory(orderSql, triggerPattern), expectedTriggers.slice(0,10), 'PAY-002 trigger')
  same(inventory(paymentSql, triggerPattern), expectedTriggers.slice(10), 'PAY-001 trigger')

  if (orderSql.includes('CREATE TABLE ledger_entries') ||
      paymentSql.includes('CREATE TABLE ledger_entries') ||
      /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:payment_intents|entitlements|saved_payment_methods|refunds|billing_documents)\b/i.test(orderSql + paymentSql)) {
    throw new Error('D1-04 order/payment slice must not create ledger, intent, entitlement or later-module tables')
  }
  if (orderSql.includes('CREATE TABLE users') || paymentSql.includes('CREATE TABLE users')) {
    throw new Error('W07 D1-04 cannot create identity/Payload users tables')
  }
  if (paymentContract.tables?.payments?.provider !== undefined &&
      paymentContract.tables.payments.provider !== 'hyperswitch') {
    throw new Error('W07 payment provider contract drift; this slice is Hyperswitch-only')
  }
  if (!orderStateText.includes('"entity": "Order"') || !paymentStateText.includes('"entity": "Payment"')) {
    throw new Error('Order/Payment lifecycle state-machine contracts are missing their entity identities')
  }
  if (contract.schema?.totals?.tables !== 6 ||
      contract.schema?.totals?.explicitIndexes !== 14 ||
      contract.schema?.totals?.triggers !== 24 ||
      contract.schema?.totals?.triggerFunctions !== 1 ||
      contract.schema?.totals?.foreignKeys !== 0) {
    throw new Error('D1-04 order/payment schema contract totals drift')
  }

  const hashes = {
    W07_ORDER_SOURCE_SHA256: sha256(orderSql),
    W07_PAYMENT_SOURCE_SHA256: sha256(paymentSql),
    ORDER_PERSISTENCE_CONTRACT_SHA256: sha256(orderContractText),
    PAYMENT_PERSISTENCE_CONTRACT_SHA256: sha256(paymentContractText),
    ORDER_STATE_MACHINE_SHA256: sha256(orderStateText),
    PAYMENT_STATE_MACHINE_SHA256: sha256(paymentStateText),
    D1_04_OWNER_LEDGER_CONTRACT_SHA256: sha256(ledgerContractText),
  }
  let migration = template
  for (const [name, value] of Object.entries(hashes)) migration = migration.replaceAll('{{' + name + '}}', value)
  if (/\\{\\{[A-Z0-9_]+\\}\\}/.test(migration)) throw new Error('Unresolved W07 D1-04 migration checksum placeholder')
  return { migration, hashes, contract }
}

function run() {
  const result = buildW07D104OrderPaymentMigration()
  const outputPathAbsolute = path.join(repositoryRoot, outputPath)
  const write = process.argv.includes('--write')
  const actual = (() => { try { return readFileSync(outputPathAbsolute,'utf8') } catch { return null } })()
  if (write) {
    writeFileSync(outputPathAbsolute,result.migration)
    process.stdout.write('NEON_D1_04_W07_ORDER_PAYMENT_MIGRATION_WRITTEN ' + JSON.stringify({
      outputPath,hashes:result.hashes,bytes:Buffer.byteLength(result.migration)
    }) + '\\n')
    return
  }
  if (actual !== result.migration) throw new Error('Committed W07 D1-04 PostgreSQL migration drift; run generator with --write and review the diff')
  process.stdout.write('NEON_D1_04_W07_ORDER_PAYMENT_MIGRATION_CURRENT ' + JSON.stringify({
    outputPath,hashes:result.hashes,bytes:Buffer.byteLength(result.migration),
    totals:result.contract.schema.totals,remoteConnectionAttempted:false,remoteDdlExecuted:false
  }) + '\\n')
}
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try { run() } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
