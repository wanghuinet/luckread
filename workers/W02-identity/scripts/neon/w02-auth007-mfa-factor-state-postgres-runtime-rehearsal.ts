import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import {
  createPostgresMfaFactorStateStore,
  readAuthoritativeMfaStatusPostgres,
} from '../../src/neon/mfa-factor-state-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing AUTH-007 factor-state rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 8,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const factorStateStore = createPostgresMfaFactorStateStore(pool)

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(
  workerRoot,
  'artifacts/neon/w02-auth007-mfa-factor-state-postgres-runtime-rehearsal.json',
)
const suffix = randomUUID().replaceAll('-', '').slice(0, 20).toLowerCase()
const userId = 'auth007-factor-state-' + suffix
const factorId = 'auth007-factor-' + suffix
const now = new Date('2026-11-09T12:00:00.000Z')
const enrolledAt = new Date(now.getTime() - 60_000)
const syntheticEncryptedSecret = 'encrypted:test-only-totp-ciphertext'
const syntheticEncryptedRecoveryCodes = 'encrypted:test-only-recovery-code-ciphertext'
let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const checks: Record<string, boolean> = {
  onlyActiveW02SubjectsPassTheAccountGate: false,
  factorReadReturnsOnlyEncryptedSecretAndLockoutTimestamp: false,
  publicStatusProjectionRequiresEnabledVerifiedAndValidEnrollmentTime: false,
  concurrentSameStepReplayReservationHasExactlyOneWinner: false,
  higherStepsAdvanceAndLowerOrRepeatedStepsAreRejected: false,
  syntheticFactorAndUserRowsCleaned: false,
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  await pool.query(
    'INSERT INTO "user" ' +
      '(id, name, email, email_verified, created_at, updated_at, two_factor_enabled, account_state, account_state_version, mfa_enrolled_at) ' +
      'VALUES ($1, $2, $3, TRUE, $4, $4, TRUE, $5, 1, $6)',
    [userId, 'AUTH-007 factor state rehearsal', userId + '@example.invalid', enrolledAt, 'ACTIVE', enrolledAt],
  )
  await pool.query(
    'INSERT INTO "twoFactor" ' +
      '(id, secret, "backupCodes", "userId", verified, "failedVerificationCount", "lockedUntil", "lastAcceptedTotpTimeStep") ' +
      'VALUES ($1, $2, $3, $4, TRUE, 0, $5, NULL)',
    [factorId, syntheticEncryptedSecret, syntheticEncryptedRecoveryCodes, userId, new Date(now.getTime() + 120_000)],
  )

  assert.equal(await factorStateStore.isActiveSubject(userId), true)
  await pool.query('UPDATE "user" SET account_state = $1 WHERE id = $2', ['SUSPENDED', userId])
  assert.equal(await factorStateStore.isActiveSubject(userId), false)
  await pool.query('UPDATE "user" SET account_state = $1 WHERE id = $2', ['ACTIVE', userId])
  assert.equal(await factorStateStore.isActiveSubject('missing-' + suffix), false)
  checks.onlyActiveW02SubjectsPassTheAccountGate = true

  const material = await factorStateStore.readVerificationMaterial(userId)
  assert.equal(material?.encryptedSecret, syntheticEncryptedSecret)
  assert.ok(material?.lockedUntil instanceof Date)
  assert.equal(Object.keys(material ?? {}).sort().join(','), 'encryptedSecret,lockedUntil')
  assert.doesNotMatch(JSON.stringify(material), /backupCodes|recovery-code-ciphertext/i)
  assert.equal(await factorStateStore.readVerificationMaterial('missing-' + suffix), null)
  checks.factorReadReturnsOnlyEncryptedSecretAndLockoutTimestamp = true

  const publicStatus = await readAuthoritativeMfaStatusPostgres(pool, userId, now)
  assert.deepEqual(publicStatus, {
    enabled: true,
    verified: true,
    enrolledAt: enrolledAt.toISOString(),
  })
  assert.equal(await readAuthoritativeMfaStatusPostgres(pool, 'missing-' + suffix, now), null)

  await pool.query('UPDATE "user" SET mfa_enrolled_at = NULL WHERE id = $1', [userId])
  assert.deepEqual(await readAuthoritativeMfaStatusPostgres(pool, userId, now), {
    enabled: false,
    verified: false,
    enrolledAt: null,
  })
  await pool.query('UPDATE "user" SET mfa_enrolled_at = $1 WHERE id = $2', [
    new Date(now.getTime() + 60_000), userId,
  ])
  assert.deepEqual(await readAuthoritativeMfaStatusPostgres(pool, userId, now), {
    enabled: false,
    verified: false,
    enrolledAt: null,
  })
  await pool.query('UPDATE "user" SET mfa_enrolled_at = $1 WHERE id = $2', [enrolledAt, userId])
  await pool.query('UPDATE "twoFactor" SET verified = FALSE WHERE "userId" = $1', [userId])
  assert.deepEqual(await readAuthoritativeMfaStatusPostgres(pool, userId, now), {
    enabled: false,
    verified: false,
    enrolledAt: null,
  })
  await pool.query('UPDATE "twoFactor" SET verified = TRUE WHERE "userId" = $1', [userId])
  await pool.query('UPDATE "user" SET two_factor_enabled = FALSE WHERE id = $1', [userId])
  assert.deepEqual(await readAuthoritativeMfaStatusPostgres(pool, userId, now), {
    enabled: false,
    verified: false,
    enrolledAt: null,
  })
  checks.publicStatusProjectionRequiresEnabledVerifiedAndValidEnrollmentTime = true

  const step = 8_000_000
  const winners = await Promise.all([
    factorStateStore.consumeTotpTimeStep(userId, step),
    factorStateStore.consumeTotpTimeStep(userId, step),
  ])
  assert.deepEqual(winners.sort(), [false, true])
  const lower = await factorStateStore.consumeTotpTimeStep(userId, step - 1)
  const repeated = await factorStateStore.consumeTotpTimeStep(userId, step)
  assert.equal(lower, false)
  assert.equal(repeated, false)
  const higher = await factorStateStore.consumeTotpTimeStep(userId, step + 1)
  assert.equal(higher, true)
  const storedStep = await pool.query<{ lastStep: number }>(
    'SELECT "lastAcceptedTotpTimeStep" AS "lastStep" FROM "twoFactor" WHERE "userId" = $1',
    [userId],
  )
  assert.equal(Number(storedStep.rows[0]?.lastStep), step + 1)
  checks.concurrentSameStepReplayReservationHasExactlyOneWinner = winners.filter(Boolean).length === 1
  checks.higherStepsAdvanceAndLowerOrRepeatedStepsAreRejected = true
} catch (error) {
  primaryError = error
} finally {
  try {
    await pool.query('DELETE FROM "twoFactor" WHERE "userId" = $1', [userId])
    await pool.query('DELETE FROM "user" WHERE id = $1', [userId])
    const remaining = await pool.query<{ users: number; factors: number }>(
      'SELECT (SELECT COUNT(*)::integer FROM "user" WHERE id = $1) AS users, ' +
        '(SELECT COUNT(*)::integer FROM "twoFactor" WHERE "userId" = $1) AS factors',
      [userId],
    )
    cleanupVerified = Number(remaining.rows[0]?.users ?? -1) === 0 &&
      Number(remaining.rows[0]?.factors ?? -1) === 0
    checks.syntheticFactorAndUserRowsCleaned = cleanupVerified
    assert.equal(cleanupVerified, true, 'all synthetic AUTH-007 factor-state rows must be removed')
  } catch (error) {
    cleanupError = error
  }
  await pool.end()
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure ? 'W02_AUTH007_MFA_FACTOR_STATE_POSTGRES_RUNTIME_REHEARSAL_FAILED' :
    'W02_AUTH007_MFA_FACTOR_STATE_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only AUTH-007 factor-state/replay adapter against disposable PostgreSQL 18; production W02 remains on D1-01.',
  postgresMajor: 18,
  database: 'luckread_schema',
  checks,
  assertionsPassed: Object.values(checks).filter(Boolean).length,
  cleanupVerified,
  productionWorkerChanged: false,
  productionD1Touched: false,
  neonRemoteTouched: false,
  businessDataImported: false,
  productionCutoverAuthorized: false,
  error: failure instanceof Error ? failure.message.slice(0, 240) : null,
}
mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')

if (failure) {
  console.error(report.status + ' ' + report.error)
  process.exitCode = 1
} else {
  console.log(report.status + ' ' + JSON.stringify(report))
}
