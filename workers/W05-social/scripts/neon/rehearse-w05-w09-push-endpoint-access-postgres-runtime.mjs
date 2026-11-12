import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { deactivateInvalidEndpoint } from '../../src/notification-push-delivery-runtime.ts'
import { createPostgresNotificationPushEndpointAccessStore } from '../../src/notification-push-endpoint-access-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_W09_PUSH_ENDPOINT_ACCESS_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_W09_PUSH_ENDPOINT_ACCESS_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_d1_03_w09_rehearsal'
) {
  throw new Error('Refusing to rehearse W05 delegated endpoint access outside disposable local PostgreSQL luckread_d1_03_w09_rehearsal')
}

const marker = 'w05-w09-endpoint-' + randomUUID()
const reportPath = process.env.W05_W09_PUSH_ENDPOINT_ACCESS_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-w09-push-endpoint-access-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresNotificationPushEndpointAccessStore(pool)
const owner = marker + '-owner'
const otherOwner = marker + '-other-owner'
const now = new Date('2026-11-12T12:00:00.000Z')
const checks = {
  recipientScopedActiveEndpoints: false,
  endpointListHardCappedAt20: false,
  newestEndpointFirst: false,
  endpointLookupRequiresOwner: false,
  matchingTokenHashCanDeactivateEndpoint: false,
  staleReceiptCannotClearRotatedToken: false,
  cleanupVerified: false,
}
let runtimePassed = false

const tokenFor = (label) => 'ExponentPushToken[' + marker.replace(/[^A-Za-z0-9_-]/g, '') + '-' + label + '-0123456789]'
const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex')
async function insertEndpoint({ id, installationId, ownerUserId, token, permissionStatus = 'granted', updatedAt }) {
  await pool.query(
    `INSERT INTO notification_push_endpoints
      (endpoint_id, installation_id, owner_user_id, provider, platform, push_token,
       permission_status, created_at, updated_at, last_seen_at)
     VALUES ($1, $2, $3, 'expo', 'android', $4, $5, $6::timestamptz, $7::timestamptz, $7::timestamptz)`,
    [id, installationId, ownerUserId, token, permissionStatus, now.toISOString(), updatedAt],
  )
}

try {
  const expectedIds = []
  for (let i = 0; i < 21; i += 1) {
    const id = marker + '-endpoint-' + String(i).padStart(2, '0')
    expectedIds.push(id)
    await insertEndpoint({
      id,
      installationId: marker + '-installation-' + String(i).padStart(2, '0'),
      ownerUserId: owner,
      token: tokenFor('active-' + i),
      updatedAt: new Date(now.getTime() + i * 60_000).toISOString(),
    })
  }
  await insertEndpoint({
    id: marker + '-other-owner-endpoint',
    installationId: marker + '-other-owner-installation',
    ownerUserId: otherOwner,
    token: tokenFor('other-owner'),
    updatedAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
  })
  await insertEndpoint({
    id: marker + '-disabled-endpoint',
    installationId: marker + '-disabled-installation',
    ownerUserId: owner,
    token: null,
    permissionStatus: 'denied',
    updatedAt: new Date(now.getTime() + 31 * 60_000).toISOString(),
  })

  const active = await store.listActiveForRecipient(owner, 80)
  assert.equal(active.length, 20)
  assert.deepEqual(active.map(row => row.endpoint_id), expectedIds.slice(1).reverse())
  assert.ok(active.every(row => row.owner_user_id === owner && row.push_token))
  checks.recipientScopedActiveEndpoints = true
  checks.endpointListHardCappedAt20 = true
  checks.newestEndpointFirst = true

  const matched = await store.findEndpointForOwner(expectedIds[20], owner)
  assert.equal(matched?.endpoint_id, expectedIds[20])
  assert.equal(await store.findEndpointForOwner(expectedIds[20], otherOwner), null)
  checks.endpointLookupRequiresOwner = true

  const clearId = marker + '-clear-endpoint'
  const clearToken = tokenFor('clear-me')
  await insertEndpoint({
    id: clearId,
    installationId: marker + '-clear-installation',
    ownerUserId: owner,
    token: clearToken,
    updatedAt: now.toISOString(),
  })
  assert.equal(await deactivateInvalidEndpoint(store, {
    endpointId: clearId,
    recipientUserId: owner,
    pushTokenHash: hashToken(clearToken),
  }, now), true)
  const cleared = await pool.query(
    'SELECT permission_status, push_token FROM notification_push_endpoints WHERE endpoint_id = $1',
    [clearId],
  )
  assert.deepEqual(cleared.rows[0], { permission_status: 'undetermined', push_token: null })
  checks.matchingTokenHashCanDeactivateEndpoint = true

  const rotatedId = marker + '-rotated-endpoint'
  const oldToken = tokenFor('old-token')
  const newToken = tokenFor('new-token')
  await insertEndpoint({
    id: rotatedId,
    installationId: marker + '-rotated-installation',
    ownerUserId: owner,
    token: oldToken,
    updatedAt: now.toISOString(),
  })
  const racingStore = {
    listActiveForRecipient: (...args) => store.listActiveForRecipient(...args),
    async findEndpointForOwner(...args) {
      const row = await store.findEndpointForOwner(...args)
      await pool.query(
        'UPDATE notification_push_endpoints SET push_token = $1, updated_at = $2::timestamptz WHERE endpoint_id = $3 AND owner_user_id = $4',
        [newToken, now.toISOString(), rotatedId, owner],
      )
      return row
    },
    clearTokenIfMatches: (input) => store.clearTokenIfMatches(input),
  }
  assert.equal(await deactivateInvalidEndpoint(racingStore, {
    endpointId: rotatedId,
    recipientUserId: owner,
    pushTokenHash: hashToken(oldToken),
  }, now), false)
  const rotated = await pool.query(
    'SELECT permission_status, push_token FROM notification_push_endpoints WHERE endpoint_id = $1',
    [rotatedId],
  )
  assert.deepEqual(rotated.rows[0], { permission_status: 'granted', push_token: newToken })
  checks.staleReceiptCannotClearRotatedToken = true
  runtimePassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM notification_push_endpoints WHERE endpoint_id LIKE $1 OR installation_id LIKE $1 OR owner_user_id LIKE $1',
      [marker + '%'],
    )
    const residual = await pool.query(
      'SELECT count(*)::int AS count FROM notification_push_endpoints WHERE endpoint_id LIKE $1 OR installation_id LIKE $1 OR owner_user_id LIKE $1',
      [marker + '%'],
    )
    assert.equal(residual.rows[0]?.count, 0, 'All synthetic W09 endpoint fixtures must be removed')
    checks.cleanupVerified = true
    const report = {
      status: runtimePassed ? 'W05_W09_PUSH_ENDPOINT_ACCESS_POSTGRES_RUNTIME_PASS' : 'W05_W09_PUSH_ENDPOINT_ACCESS_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: residual.rows[0]?.count ?? -1,
      rawPushTokensWrittenToReport: false,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      w09EndpointAuthorityChanged: false,
      businessDataImported: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_W09_PUSH_ENDPOINT_ACCESS_POSTGRES_RUNTIME_PASS ' : 'W05_W09_PUSH_ENDPOINT_ACCESS_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
    if (!runtimePassed) process.exitCode = 1
  } finally {
    await pool.end()
  }
}
