import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { buildMfaAuditEvent } from './mfa-audit-events.js'
import { createD1MfaEnrollmentStartStore } from './mfa-enrollment-start-store.js'

const makeDb = () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    'CREATE TABLE "user" (' +
      'id TEXT PRIMARY KEY, ' +
      'two_factor_enabled INTEGER NOT NULL DEFAULT 0, ' +
      'mfa_enrollment_key_hash TEXT)',
  )
  sqlite.exec('CREATE TABLE "twoFactor" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE)')
  sqlite.exec(
    'CREATE TABLE auth_007_mfa_publication_journal (' +
      'journal_id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL, ' +
      'schema_version TEXT NOT NULL, resource_id TEXT NOT NULL, source_version INTEGER NOT NULL, ' +
      'idempotency_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL, ' +
      'next_attempt_at TEXT, created_at TEXT NOT NULL, published_at TEXT, last_error_code TEXT)',
  )
  sqlite.prepare(
    'INSERT INTO "user" (id, two_factor_enabled, mfa_enrollment_key_hash) VALUES (?, 0, NULL)',
  ).run('user-mfa-start-123')

  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      let values: (string | number | null)[] = []
      return {
        bind(...next: (string | number | null)[]) {
          values = next
          return this
        },
        async run() {
          const result = statement.run(...values)
          return { success: true, meta: { changes: Number(result.changes) } }
        },
      }
    },
    async batch(prepared: Array<{ run: () => Promise<{ success: boolean; meta: { changes: number } }> }>) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of prepared) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { db, sqlite, close: () => sqlite.close() }
}

const userId = 'user-mfa-start-123'
const keyHash = 'a'.repeat(64)
const startedEvent = () => buildMfaAuditEvent({
  eventType: 'auth.mfa.enrollment_started',
  operationId: 'authMfaEnrollmentStart',
  userId,
  occurredAt: '2026-11-10T12:00:00.000Z',
  correlationId: 'req_mfa_start_001',
  causationId: 'trace_mfa_start_001',
  result: 'started',
  reasonCode: 'USER_INITIATED',
  factorState: 'PENDING_VERIFICATION',
})
const failureEvent = () => buildMfaAuditEvent({
  eventType: 'auth.mfa.enrollment_failed',
  operationId: 'authMfaEnrollmentStart',
  userId,
  occurredAt: '2026-11-10T12:01:00.000Z',
  correlationId: 'req_mfa_start_002',
  causationId: 'trace_mfa_start_002',
  result: 'failed',
  reasonCode: 'UPSTREAM_UNAVAILABLE',
  factorState: 'PENDING_VERIFICATION',
})

describe('W02 D1 MFA enrollment-start store', () => {
  it('reserves one pending enrollment and writes its secret-free audit intent atomically', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentStartStore(db)
      await expect(store.reserve({ userId, keyHash, event: startedEvent() })).resolves.toBe(true)

      const account = sqlite.prepare('SELECT mfa_enrollment_key_hash FROM "user" WHERE id = ?')
        .get(userId) as { mfa_enrollment_key_hash: string | null }
      expect(account.mfa_enrollment_key_hash).toBe(keyHash)

      const journal = sqlite.prepare(
        'SELECT event_type, resource_id, status, payload FROM auth_007_mfa_publication_journal',
      ).get() as { event_type: string; resource_id: string; status: string; payload: string }
      expect(journal).toMatchObject({
        event_type: 'auth.mfa.enrollment_started',
        resource_id: userId,
        status: 'PENDING',
      })
      expect(journal.payload).not.toContain(keyHash)
      expect(journal.payload).not.toContain('recoveryCodes')
      expect(journal.payload).not.toContain('secret')
    } finally {
      close()
    }
  })

  it('allows only one competing reservation and does not append a second audit row', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentStartStore(db)
      await expect(store.reserve({ userId, keyHash, event: startedEvent() })).resolves.toBe(true)
      await expect(store.reserve({
        userId,
        keyHash: 'b'.repeat(64),
        event: buildMfaAuditEvent({
          eventType: 'auth.mfa.enrollment_started',
          operationId: 'authMfaEnrollmentStart',
          userId,
          result: 'started',
          reasonCode: 'USER_INITIATED',
          factorState: 'PENDING_VERIFICATION',
        }),
      })).resolves.toBe(false)
      expect(Number(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_007_mfa_publication_journal').get()?.count)).toBe(1)
    } finally {
      close()
    }
  })

  it('does not reserve a user with an existing TOTP factor', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      sqlite.prepare('INSERT INTO "twoFactor" (id, "userId") VALUES (?, ?)').run('factor-1', userId)
      const store = createD1MfaEnrollmentStartStore(db)
      await expect(store.reserve({ userId, keyHash, event: startedEvent() })).resolves.toBe(false)
      const account = sqlite.prepare('SELECT mfa_enrollment_key_hash FROM "user" WHERE id = ?')
        .get(userId) as { mfa_enrollment_key_hash: string | null }
      expect(account.mfa_enrollment_key_hash).toBeNull()
      expect(Number(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_007_mfa_publication_journal').get()?.count)).toBe(0)
    } finally {
      close()
    }
  })

  it('clears the matching reservation after an upstream failure when no factor was materialized', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentStartStore(db)
      await store.reserve({ userId, keyHash, event: startedEvent() })
      await store.releaseReservationIfNoFactor(userId, keyHash)
      const account = sqlite.prepare('SELECT mfa_enrollment_key_hash FROM "user" WHERE id = ?')
        .get(userId) as { mfa_enrollment_key_hash: string | null }
      expect(account.mfa_enrollment_key_hash).toBeNull()
    } finally {
      close()
    }
  })

  it('releases only an unmaterialized matching reservation', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentStartStore(db)
      await store.reserve({ userId, keyHash, event: startedEvent() })
      sqlite.prepare('INSERT INTO "twoFactor" (id, "userId") VALUES (?, ?)').run('factor-1', userId)
      await store.releaseReservationIfNoFactor(userId, keyHash)
      const account = sqlite.prepare('SELECT mfa_enrollment_key_hash FROM "user" WHERE id = ?')
        .get(userId) as { mfa_enrollment_key_hash: string | null }
      expect(account.mfa_enrollment_key_hash).toBe(keyHash)
    } finally {
      close()
    }
  })

  it('writes failure outcomes without exposing request credentials or factor material', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentStartStore(db)
      await store.recordFailure(failureEvent())
      const row = sqlite.prepare('SELECT payload FROM auth_007_mfa_publication_journal').get() as { payload: string }
      expect(JSON.parse(row.payload)).toMatchObject({
        eventType: 'auth.mfa.enrollment_failed',
        resourceId: userId,
        payload: {
          operationId: 'authMfaEnrollmentStart',
          result: 'failed',
          reasonCode: 'UPSTREAM_UNAVAILABLE',
        },
      })
      expect(row.payload).not.toContain('password')
      expect(row.payload).not.toContain('totp')
      expect(row.payload).not.toContain('recovery')
    } finally {
      close()
    }
  })

  it('rejects malformed reservation identity before issuing D1 commands', async () => {
    const { db, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentStartStore(db)
      await expect(store.reserve({ userId: '../user', keyHash, event: startedEvent() })).rejects.toThrow(TypeError)
      await expect(store.reserve({ userId, keyHash: 'not-a-hash', event: startedEvent() })).rejects.toThrow(TypeError)
    } finally {
      close()
    }
  })
})
