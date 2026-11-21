import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from '../../src/social-closure-runtime.ts'
import { createPostgresNotificationPreferencesStore } from '../../src/notification-preferences-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_NOTIFICATION_PREFERENCES_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_NOTIFICATION_PREFERENCES_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const marker = 'w05-notification-preferences-' + randomUUID()
const reportPath = process.env.W05_NOTIFICATION_PREFERENCES_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-notification-preferences-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresNotificationPreferencesStore(pool)
const existingUser = marker + '-existing'
const newUser = marker + '-new'
let defaultOnReadPassed = false
let existingReadPassed = false
let partialUpdatePassed = false
let newUserDefaultsPassed = false

try {
  await pool.query(
    'INSERT INTO social_notification_preferences (user_id, follow_enabled, like_enabled, comment_enabled, mention_enabled, updated_at) VALUES ($1, 0, 0, 1, 1, CURRENT_TIMESTAMP)',
    [existingUser],
  )

  assert.deepEqual(await getNotificationPreferences(store, marker + '-no-row'), {
    follow: true, like: true, comment: true, mention: true,
  })
  defaultOnReadPassed = true

  assert.deepEqual(await getNotificationPreferences(store, existingUser), {
    follow: false, like: false, comment: true, mention: true,
  })
  existingReadPassed = true

  assert.deepEqual(await setNotificationPreferences(store, existingUser, {
    like: true,
    mention: false,
  }), {
    follow: false, like: true, comment: true, mention: false,
  })
  assert.deepEqual(await getNotificationPreferences(store, existingUser), {
    follow: false, like: true, comment: true, mention: false,
  })
  partialUpdatePassed = true

  assert.deepEqual(await setNotificationPreferences(store, newUser, {
    comment: false,
  }), {
    follow: true, like: true, comment: false, mention: true,
  })
  newUserDefaultsPassed = true
} finally {
  try {
    await pool.query('DELETE FROM social_notification_preferences WHERE user_id LIKE $1', [marker + '%'])
    const result = await pool.query(
      'SELECT count(*)::int AS rows FROM social_notification_preferences WHERE user_id LIKE $1',
      [marker + '%'],
    )
    const remaining = result.rows[0]?.rows ?? -1
    assert.equal(remaining, 0, 'All synthetic preference rows must be removed')
    const passed = defaultOnReadPassed && existingReadPassed && partialUpdatePassed && newUserDefaultsPassed
    const report = {
      status: passed
        ? 'W05_NOTIFICATION_PREFERENCES_POSTGRES_RUNTIME_PASS'
        : 'W05_NOTIFICATION_PREFERENCES_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      defaultOnRead: defaultOnReadPassed,
      existingPreferenceRead: existingReadPassed,
      partialPatchPreservesUnspecifiedFields: partialUpdatePassed,
      newUserPatchDefaultsUnspecifiedFieldsOn: newUserDefaultsPassed,
      fixtureCleanupVerified: true,
      remainingFixtureRows: remaining,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((passed ? 'W05_NOTIFICATION_PREFERENCES_POSTGRES_RUNTIME_PASS ' : 'W05_NOTIFICATION_PREFERENCES_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
    if (!passed) process.exitCode = 1
  } finally {
    await pool.end()
  }
}
