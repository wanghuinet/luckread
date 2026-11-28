import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveCommerceOrderItems } from '../../src/order-item-resolution.ts'
import { SubscriptionRuntimeError } from '../../src/subscription-runtime.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W07_ORDER_ITEM_RESOLUTION_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W07_ORDER_ITEM_RESOLUTION_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_schema') {
  throw new Error('Refusing to rehearse W07 item resolution outside disposable local PostgreSQL luckread_schema')
}

const reportPath = process.env.W07_ORDER_ITEM_RESOLUTION_POSTGRES_REPORT ||
  'artifacts/neon/w07-order-item-resolution-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 })
const client = await pool.connect()
const marker = 'w07-item-resolution-' + randomUUID()
const createdAt = new Date().toISOString()
const planId = 'plan_' + randomBytes(32).toString('hex')
const privatePlanId = 'plan_' + randomBytes(32).toString('hex')
const missingVersionPlanId = 'plan_' + randomBytes(32).toString('hex')
const planIds = [planId, privatePlanId, missingVersionPlanId]
const checks = {
  resolvesCurrentImmutableVersion: false,
  ignoresHistoricalPriceVersion: false,
  rejectsPrivateOffer: false,
  rejectsMissingCurrentVersion: false,
  rejectsUnsupportedQuantity: false,
  rejectsMultipleMembershipCart: false,
  fixtureRowsRolledBack: false,
}

const database = {
  query(sql, values) {
    return client.query(sql, values)
  },
  async connect() {
    throw new Error('Order item resolution must remain read-only and must not acquire a write client')
  },
}

async function insertPlan(id, options) {
  await client.query(
    'INSERT INTO membership_plans ' +
    '(plan_id, owner_type, owner_id, current_version, status, visibility, version, created_at, updated_at) ' +
    'VALUES ($1, \'CREATOR\', $2, $3, $4, $5, 1, $6::timestamptz, $6::timestamptz)',
    [id, marker, options.currentVersion, options.status, options.visibility, createdAt],
  )
}

async function insertVersion(id, version, name, priceMinor) {
  await client.query(
    'INSERT INTO membership_plan_versions ' +
    '(plan_id, plan_version, name, tier, billing_interval, price_minor, currency, benefits_json, created_at, trial_period_days) ' +
    'VALUES ($1, $2, $3, \'supporter\', \'MONTHLY\', $4, \'USD\', \'["Member posts"]\', $5::timestamptz, 0)',
    [id, version, name, priceMinor, createdAt],
  )
}

let transactionStarted = false
let failure
try {
  await client.query('BEGIN')
  transactionStarted = true

  // The current-version pointer is 2 while version 1 remains immutable at its
  // historical price. Resolution must return version 2 and its price only.
  await insertPlan(planId, { currentVersion: 2, status: 'ACTIVE', visibility: 'PUBLIC' })
  await insertVersion(planId, 1, 'Historical Supporter', 3900)
  await insertVersion(planId, 2, 'Current Supporter', 4900)

  // A private plan must not be discoverable through the public checkout path.
  await insertPlan(privatePlanId, { currentVersion: 1, status: 'ACTIVE', visibility: 'PRIVATE' })
  await insertVersion(privatePlanId, 1, 'Private Supporter', 9900)

  // A current_version pointer without a matching immutable version must fail closed.
  await insertPlan(missingVersionPlanId, { currentVersion: 2, status: 'ACTIVE', visibility: 'PUBLIC' })
  await insertVersion(missingVersionPlanId, 1, 'Incomplete Supporter', 1200)

  const resolved = await resolveCommerceOrderItems(database, {
    items: [{ itemRef: planId, quantity: 1 }],
  })
  assert.equal(resolved.currency, 'USD')
  assert.equal(resolved.items.length, 1)
  assert.equal(resolved.items[0].itemRef, planId)
  assert.equal(resolved.items[0].itemVersion, '2')
  assert.equal(resolved.items[0].unitAmountMinor, 4900)
  const snapshot = JSON.parse(resolved.items[0].itemSnapshotJson)
  assert.equal(snapshot.planVersion, 2)
  assert.equal(snapshot.name, 'Current Supporter')
  assert.equal(snapshot.priceMinor, 4900)
  checks.resolvesCurrentImmutableVersion = true
  checks.ignoresHistoricalPriceVersion = true

  await assert.rejects(
    resolveCommerceOrderItems(database, { items: [{ itemRef: privatePlanId, quantity: 1 }] }),
    (error) => error instanceof SubscriptionRuntimeError &&
      error.code === 'RESOURCE_NOT_FOUND' && error.status === 404,
  )
  checks.rejectsPrivateOffer = true

  await assert.rejects(
    resolveCommerceOrderItems(database, { items: [{ itemRef: missingVersionPlanId, quantity: 1 }] }),
    (error) => error instanceof SubscriptionRuntimeError &&
      error.code === 'RESOURCE_NOT_FOUND' && error.status === 404,
  )
  checks.rejectsMissingCurrentVersion = true

  await assert.rejects(
    resolveCommerceOrderItems(database, { items: [{ itemRef: planId, quantity: 2 }] }),
    (error) => error instanceof SubscriptionRuntimeError &&
      error.code === 'VALIDATION_FAILED' && error.status === 400,
  )
  checks.rejectsUnsupportedQuantity = true

  await assert.rejects(
    resolveCommerceOrderItems(database, {
      items: [
        { itemRef: planId, quantity: 1 },
        { itemRef: privatePlanId, quantity: 1 },
      ],
    }),
    (error) => error instanceof SubscriptionRuntimeError &&
      error.code === 'VALIDATION_FAILED' && error.status === 400,
  )
  checks.rejectsMultipleMembershipCart = true
} catch (error) {
  failure = error
} finally {
  if (transactionStarted) {
    await client.query('ROLLBACK')
  }
  client.release()
  const [plans, versions] = await Promise.all([
    pool.query('SELECT count(*)::int AS count FROM membership_plans WHERE plan_id = ANY($1::text[])', [planIds]),
    pool.query('SELECT count(*)::int AS count FROM membership_plan_versions WHERE plan_id = ANY($1::text[])', [planIds]),
  ])
  checks.fixtureRowsRolledBack =
    Number(plans.rows[0]?.count ?? -1) === 0 &&
    Number(versions.rows[0]?.count ?? -1) === 0
  await pool.end()
}

const report = {
  domainId: 'D1-01',
  databaseName: 'luckread_schema',
  postgresMajor: 18,
  checks,
  remoteNeonTouched: false,
  cloudflareD1Touched: false,
  businessDataImported: false,
  productionCutoverAuthorized: false,
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(report, null, 2))
if (failure) throw failure
if (Object.values(checks).some((passed) => passed !== true)) {
  throw new Error('W07 membership item-resolution PostgreSQL 18 rehearsal incomplete')
}
