import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createCommerceOrder, OrderPersistenceError } from '../../src/order-persistence.ts'
import { createPostgresOrderCreateStore } from '../../src/order-create-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W07_ORDER_PERSISTENCE_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W07_ORDER_PERSISTENCE_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_finance_schema') {
  throw new Error('Refusing to rehearse W07 order persistence outside disposable local PostgreSQL luckread_finance_schema')
}

const reportPath = process.env.W07_ORDER_PERSISTENCE_POSTGRES_REPORT ||
  'artifacts/neon/w07-order-persistence-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 })
const store = createPostgresOrderCreateStore(pool)
const marker = 'w07-order-pg18-' + randomUUID()
const now = new Date('2026-11-11T12:00:00.000Z')
const nowIso = now.toISOString()
const checks = {
  createsOrderAndImmutableLine: false,
  sameKeySamePayloadReplays: false,
  sameKeyDifferentPayloadConflicts: false,
  expiredIdempotencyCanBeReclaimed: false,
  concurrentSubmissionsConvergeToOneOrder: false,
  lineFailureRollsBackClaimAndOrder: false,
  failedKeyCanBeRetried: false,
  fixtureRowsCleaned: false,
}

const requestFor = (suffix = 'plan_main') => ({
  items: [{ itemRef: suffix, quantity: 1 }],
})

const pricingFor = async (request) => ({
  currency: 'USD',
  items: request.items.map((item) => ({
    itemType: 'MEMBERSHIP_PLAN',
    itemRef: item.itemRef,
    itemVersion: '1',
    quantity: item.quantity,
    unitAmountMinor: 1200,
    currency: 'USD',
    lineDiscountMinor: 0,
    lineTaxMinor: 0,
    itemSnapshotJson: JSON.stringify({ planId: item.itemRef, planVersion: 1 }),
  })),
})

function dependencies(prefix, options = {}) {
  let next = 0
  return {
    now: () => new Date(now),
    createId(kind) {
      if (kind === 'line' && options.duplicateLineIds) return prefix + '_same_line'
      next += 1
      return prefix + '_' + kind + '_' + next
    },
  }
}

async function count(table, customerId) {
  const result = await pool.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE customer_id = $1`,
    [customerId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function clearFixtures() {
  await pool.query('TRUNCATE TABLE order_lines, orders, order_create_idempotency')
}

try {
  await clearFixtures()

  // Positive create + replay: the returned DTO must be the persisted response
  // and the replay must not call pricing or create another Order/OrderLine.
  {
    const customerId = marker + '-customer-create'
    const request = requestFor('plan-main')
    const created = await createCommerceOrder(
      store, customerId, 'create-key', request, pricingFor, dependencies('create'),
    )
    assert.equal(created.status, 201)
    assert.equal(created.replayed, false)
    assert.equal(created.data.status, 'CREATED')
    assert.equal(created.data.totalMinor, 1200)
    assert.equal(await count('orders', customerId), 1)
    const persistedLines = await pool.query(
      'SELECT order_line_id, order_id, item_ref, item_snapshot_json FROM order_lines WHERE order_id = $1',
      [created.data.orderId],
    )
    assert.equal(persistedLines.rows.length, 1)
    assert.equal(persistedLines.rows[0]?.item_ref, 'plan-main')
    assert.equal(persistedLines.rows[0]?.order_id, created.data.orderId)

    let replayPricingCalls = 0
    const replay = await createCommerceOrder(
      store,
      customerId,
      'create-key',
      request,
      async (value) => { replayPricingCalls += 1; return pricingFor(value) },
      dependencies('replay'),
    )
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.data, created.data)
    assert.equal(replayPricingCalls, 0)
    assert.equal(await count('orders', customerId), 1)
    checks.createsOrderAndImmutableLine = true
    checks.sameKeySamePayloadReplays = true

    await assert.rejects(
      createCommerceOrder(
        store, customerId, 'create-key', requestFor('plan-different'),
        async (value) => pricingFor(value), dependencies('conflict'),
      ),
      (error) => error instanceof OrderPersistenceError &&
        error.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT' && error.status === 409,
    )
    checks.sameKeyDifferentPayloadConflicts = true
  }

  // An expired IN_PROGRESS claim is deleted and replaced in the same database
  // transaction; no terminal or live idempotency evidence is overwritten.
  {
    const customerId = marker + '-customer-expired'
    const key = 'expired-key'
    const expiredId = marker + '-expired-id'
    await pool.query(
      `INSERT INTO order_create_idempotency
        (id, customer_id, operation_key, idempotency_key, request_hash, state,
         response_status, response_json, created_at, expires_at)
       VALUES ($1, $2, 'POST /v1/commerce/orders', $3, $4, 'IN_PROGRESS',
         NULL, NULL, $5, $6)`,
      [
        expiredId, customerId, key, 'b'.repeat(64),
        '2026-11-10T12:00:00.000Z', '2026-11-11T11:00:00.000Z',
      ],
    )
    const result = await createCommerceOrder(
      store, customerId, key, requestFor('plan-expired'), pricingFor, dependencies('expired'),
    )
    assert.equal(result.replayed, false)
    const records = await pool.query(
      'SELECT id, state FROM order_create_idempotency WHERE customer_id = $1',
      [customerId],
    )
    assert.equal(records.rows.length, 1)
    assert.notEqual(records.rows[0]?.id, expiredId)
    assert.equal(records.rows[0]?.state, 'COMPLETED')
    checks.expiredIdempotencyCanBeReclaimed = true
  }

  // Race two independent callers on the same customer/key. Exactly one creates
  // the Order; the loser re-reads and returns the committed response.
  {
    const customerId = marker + '-customer-race'
    const request = requestFor('plan-race')
    const [left, right] = await Promise.all([
      createCommerceOrder(store, customerId, 'race-key', request, pricingFor, dependencies('race-left')),
      createCommerceOrder(store, customerId, 'race-key', request, pricingFor, dependencies('race-right')),
    ])
    assert.equal(left.data.orderId, right.data.orderId)
    assert.deepEqual([left.replayed, right.replayed].sort(), [false, true])
    assert.equal(await count('orders', customerId), 1)
    const lineCount = await pool.query(
      'SELECT count(*)::int AS count FROM order_lines WHERE order_id = $1',
      [left.data.orderId],
    )
    assert.equal(Number(lineCount.rows[0]?.count), 1)
    checks.concurrentSubmissionsConvergeToOneOrder = true
  }

  // Duplicate generated line IDs produce a real PostgreSQL unique violation
  // after the idempotency claim and Order insert. PostgreSQL must roll all of
  // them back so the same key can be retried with new IDs.
  {
    const customerId = marker + '-customer-rollback'
    const request = { items: [
      { itemRef: 'plan-rollback-a', quantity: 1 },
      { itemRef: 'plan-rollback-b', quantity: 1 },
    ] }
    const duplicatePricing = async (value) => ({
      currency: 'USD',
      items: value.items.map((item) => ({
        itemType: 'MEMBERSHIP_PLAN',
        itemRef: item.itemRef,
        itemVersion: '1',
        quantity: item.quantity,
        unitAmountMinor: 1200,
        currency: 'USD',
        lineDiscountMinor: 0,
        lineTaxMinor: 0,
        itemSnapshotJson: JSON.stringify({ planId: item.itemRef, planVersion: 1 }),
      })),
    })

    await assert.rejects(
      createCommerceOrder(
        store, customerId, 'retry-after-rollback', request, duplicatePricing,
        dependencies(marker + '-rollback', { duplicateLineIds: true }),
      ),
      (error) => error instanceof OrderPersistenceError &&
        error.code === 'CONFLICT' && error.status === 409,
    )
    assert.equal(await count('orders', customerId), 0)
    assert.equal(await count('order_create_idempotency', customerId), 0)
    const partialLines = await pool.query(
      'SELECT count(*)::int AS count FROM order_lines WHERE order_id LIKE $1',
      [marker + '-rollback_order_%'],
    )
    assert.equal(Number(partialLines.rows[0]?.count), 0)
    checks.lineFailureRollsBackClaimAndOrder = true

    const retried = await createCommerceOrder(
      store, customerId, 'retry-after-rollback', request, duplicatePricing, dependencies('retry'),
    )
    assert.equal(retried.replayed, false)
    assert.equal(await count('orders', customerId), 1)
    const lines = await pool.query(
      'SELECT count(*)::int AS count FROM order_lines WHERE order_id = $1',
      [retried.data.orderId],
    )
    assert.equal(Number(lines.rows[0]?.count), 2)
    checks.failedKeyCanBeRetried = true
  }

  const scenarioChecks = Object.entries(checks)
    .filter(([name]) => name !== 'fixtureRowsCleaned')
    .map(([, passed]) => passed)
  if (scenarioChecks.some((passed) => !passed)) {
    throw new Error('W07 order persistence rehearsal incomplete: ' + JSON.stringify(checks))
  }
} finally {
  await clearFixtures()
  const [orders, lines, idempotency] = await Promise.all([
    pool.query('SELECT count(*)::int AS count FROM orders'),
    pool.query('SELECT count(*)::int AS count FROM order_lines'),
    pool.query('SELECT count(*)::int AS count FROM order_create_idempotency'),
  ])
  checks.fixtureRowsCleaned =
    Number(orders.rows[0]?.count ?? -1) === 0 &&
    Number(lines.rows[0]?.count ?? -1) === 0 &&
    Number(idempotency.rows[0]?.count ?? -1) === 0

  const report = {
    domainId: 'D1-04',
    databaseName: 'luckread_finance_schema',
    postgresMajor: 18,
    checks,
    finalCounts: {
      orders: Number(orders.rows[0]?.count ?? -1),
      orderLines: Number(lines.rows[0]?.count ?? -1),
      orderCreateIdempotency: Number(idempotency.rows[0]?.count ?? -1),
    },
    remoteNeonTouched: false,
    cloudflareD1Touched: false,
    businessDataImported: false,
    productionCutoverAuthorized: false,
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  await pool.end()
  if (!checks.fixtureRowsCleaned) throw new Error('W07 order persistence cleanup left fixture rows: ' + JSON.stringify(report))
  console.log('W07_D1_04_ORDER_PERSISTENCE_POSTGRES18_PASS ' + JSON.stringify(report))
}
