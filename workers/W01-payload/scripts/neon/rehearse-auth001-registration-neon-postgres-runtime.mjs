import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

import {
  closeW01RegistrationPostgresRuntimeForTest,
  getW01RegistrationPersistenceStore,
} from '../../src/auth/registration-persistence.ts'

const requireFromW01 = createRequire(new URL('../../package.json', import.meta.url))
const { Pool } = requireFromW01('pg')
const connectionString = process.env.PAYLOAD_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('PAYLOAD_SCHEMA_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_schema'
) {
  throw new Error('Refusing AUTH-001 rehearsal outside disposable local PostgreSQL luckread_schema')
}

const marker = 'auth001-neon-pg18-' + randomUUID().replaceAll('-', '')
const reportPath = process.env.AUTH001_NEON_POSTGRES_REPORT ??
  'artifacts/neon/w01-auth001-registration-neon-postgres-runtime-postflight.json'
const adminPool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 })
const hyperdriveBinding = { connectionString }
const d1Accesses = { prepare: 0, batch: 0 }
const d1Sentinel = {
  prepare() {
    d1Accesses.prepare += 1
    throw new Error('W01 AUTH-001 Neon store must not access legacy D1')
  },
  batch() {
    d1Accesses.batch += 1
    throw new Error('W01 AUTH-001 Neon store must not write legacy D1')
  },
}
const store = getW01RegistrationPersistenceStore({
  PAYLOAD_DATABASE_DRIVER: 'neon',
  HYPERDRIVE: hyperdriveBinding,
  D1: d1Sentinel,
})
const now = new Date()
const nowIso = now.toISOString()
const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
const past = new Date(now.getTime() - 60 * 1000).toISOString()
const committedResponse = JSON.stringify({
  userId: marker + '-identity',
  accountState: 'PENDING_VERIFICATION',
})

const checks = {
  neonDriverSelected: true,
  firstReservationPersisted: false,
  activeKeyUniquenessEnforced: false,
  completedResponseAndConsentCommittedAtomically: false,
  completedIdempotencyReplayReadable: false,
  releasedReservationRemoved: false,
  expiredReservationReplaced: false,
  failedConsentWriteRolledBackEnvelopeUpdate: false,
  legacyD1BindingsNeverAccessed: false,
  syntheticRowsCleaned: false,
}
let passed = false
let failure

function reservation(key, id, consentId, overrides = {}) {
  return {
    reservationId: id,
    idempotencyKey: key,
    payloadHash: 'a'.repeat(64),
    responseDigest: 'b'.repeat(64),
    consentRecordId: consentId,
    expiresAt: future,
    now: nowIso,
    existing: null,
    ...overrides,
  }
}

try {
  const key = marker + '-idempotency'
  const reservationId = marker + '-reservation-1'
  const consentId = marker + '-consent-1'

  await store.reserveEnvelope(reservation(key, reservationId, consentId))
  const first = await store.getExistingEnvelope(key)
  assert.equal(first?.id, reservationId)
  assert.equal(first?.state, 'IN_PROGRESS')
  checks.firstReservationPersisted = true

  await assert.rejects(
    store.reserveEnvelope(reservation(key, marker + '-reservation-duplicate', marker + '-consent-duplicate')),
    (error) => error?.code === '23505' &&
      error?.constraint === 'auth_registration_envelopes_active_key_idx',
  )
  checks.activeKeyUniquenessEnforced = true

  await store.completeRegistration({
    reservationId,
    consentRecordId: consentId,
    userId: marker + '-identity',
    policyVersion: 'PRIV-004/registration-v1',
    retentionUntil: future,
    sourceAuthority: 'W01',
    committedResponse,
    now: nowIso,
  })

  const completed = await store.getExistingEnvelope(key)
  assert.equal(completed?.state, 'COMPLETED')
  assert.equal(completed?.committedResponse, committedResponse)
  const committedRows = await adminPool.query(
    'SELECT id, actor_subject_id, owner_subject_id, resource_id, purpose, state, ' +
      'policy_version, legal_basis, retention_class, source_authority ' +
      'FROM consents WHERE id = $1',
    [consentId],
  )
  assert.deepEqual(committedRows.rows, [{
    id: consentId,
    actor_subject_id: marker + '-identity',
    owner_subject_id: marker + '-identity',
    resource_id: marker + '-identity',
    purpose: 'ACCOUNT_REGISTRATION',
    state: 'GRANTED',
    policy_version: 'PRIV-004/registration-v1',
    legal_basis: 'CONSENT',
    retention_class: 'LEGAL_AUDIT',
    source_authority: 'W01',
  }])
  checks.completedResponseAndConsentCommittedAtomically = true

  const replay = await store.getExistingEnvelope(key)
  assert.equal(replay?.state, 'COMPLETED')
  assert.equal(replay?.committedResponse, committedResponse)
  checks.completedIdempotencyReplayReadable = true

  const releaseKey = marker + '-release'
  const releaseId = marker + '-release-reservation'
  await store.reserveEnvelope(reservation(releaseKey, releaseId, marker + '-release-consent'))
  await store.releaseReservation(releaseId)
  assert.equal(await store.getExistingEnvelope(releaseKey), null)
  checks.releasedReservationRemoved = true

  const expiredKey = marker + '-expired'
  const expiredId = marker + '-expired-reservation'
  await store.reserveEnvelope(reservation(expiredKey, expiredId, marker + '-expired-consent', {
    expiresAt: past,
  }))
  const expired = await store.getExistingEnvelope(expiredKey)
  assert.equal(expired?.id, expiredId)
  assert.ok(Date.parse(expired.expiresAt) < Date.parse(nowIso))
  const replacementId = marker + '-replacement-reservation'
  await store.reserveEnvelope(reservation(
    expiredKey,
    replacementId,
    marker + '-replacement-consent',
    { existing: expired },
  ))
  const replacement = await store.getExistingEnvelope(expiredKey)
  assert.equal(replacement?.id, replacementId)
  assert.equal(replacement?.state, 'IN_PROGRESS')
  checks.expiredReservationReplaced = true

  const rollbackKey = marker + '-rollback'
  const rollbackId = marker + '-rollback-reservation'
  const rollbackConsentId = marker + '-rollback-consent'
  await store.reserveEnvelope(reservation(rollbackKey, rollbackId, rollbackConsentId))
  await assert.rejects(
    store.completeRegistration({
      reservationId: rollbackId,
      consentRecordId: rollbackConsentId,
      userId: marker + '-rollback-identity',
      policyVersion: 'PRIV-004/registration-v1',
      retentionUntil: 'not-a-valid-timestamp',
      sourceAuthority: 'W01',
      committedResponse,
      now: nowIso,
    }),
  )
  const rolledBackEnvelope = await store.getExistingEnvelope(rollbackKey)
  const rolledBackConsent = await adminPool.query(
    'SELECT COUNT(*)::int AS count FROM consents WHERE id = $1',
    [rollbackConsentId],
  )
  assert.equal(rolledBackEnvelope?.state, 'IN_PROGRESS')
  assert.equal(Number(rolledBackConsent.rows[0]?.count), 0)
  checks.failedConsentWriteRolledBackEnvelopeUpdate = true

  assert.equal(d1Accesses.prepare, 0)
  assert.equal(d1Accesses.batch, 0)
  checks.legacyD1BindingsNeverAccessed = true
  passed = true
} catch (error) {
  failure = error
} finally {
  try {
    await closeW01RegistrationPostgresRuntimeForTest(hyperdriveBinding)
  } catch (cleanupError) {
    failure ??= cleanupError
  }

  try {
    await adminPool.query(
      'DELETE FROM consents WHERE id LIKE $1',
      [marker + '%'],
    )
    await adminPool.query(
      'DELETE FROM auth_registration_envelopes WHERE idempotency_key LIKE $1 OR id LIKE $1',
      [marker + '%'],
    )
    const counts = await adminPool.query(
      'SELECT ' +
        '(SELECT COUNT(*)::int FROM consents WHERE id LIKE $1) AS consents, ' +
        '(SELECT COUNT(*)::int FROM auth_registration_envelopes WHERE idempotency_key LIKE $1 OR id LIKE $1) AS envelopes',
      [marker + '%'],
    )
    checks.syntheticRowsCleaned =
      Number(counts.rows[0]?.consents) === 0 &&
      Number(counts.rows[0]?.envelopes) === 0
  } catch (cleanupError) {
    failure ??= cleanupError
  }

  const report = {
    status: passed && !failure && checks.syntheticRowsCleaned
      ? 'W01_AUTH001_REGISTRATION_NEON_POSTGRES18_PASS'
      : 'W01_AUTH001_REGISTRATION_NEON_POSTGRES18_FAILED',
    scope: 'Local disposable PostgreSQL 18 only. Exercises W01 registration idempotency and consent transaction stores in explicit Neon mode.',
    database: target.pathname.slice(1),
    ...checks,
    d1Accesses,
    remoteNeonTouched: false,
    cloudflareD1Touched: false,
    businessDataImported: false,
    productionWorkerBindingsChanged: false,
    productionCutoverAuthorized: false,
  }
  try {
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  } finally {
    await adminPool.end()
  }
}

if (failure) throw failure
if (!passed || !checks.syntheticRowsCleaned) {
  throw new Error('W01 AUTH-001 Neon PostgreSQL rehearsal incomplete: ' + JSON.stringify(checks))
}
console.log('W01_AUTH001_REGISTRATION_NEON_POSTGRES18_PASS ' + JSON.stringify(checks))
