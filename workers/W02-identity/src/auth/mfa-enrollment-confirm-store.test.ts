import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createD1MfaEnrollmentConfirmStore } from './mfa-enrollment-confirm-store.js'

const userId = 'user-mfa-confirm-123'
const keyHash = 'a'.repeat(64)
const requestHash = 'b'.repeat(64)

const makeDb = () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    'CREATE TABLE "user" (' +
      'id TEXT PRIMARY KEY, two_factor_enabled INTEGER NOT NULL DEFAULT 0, ' +
      'mfa_enrollment_key_hash TEXT, mfa_enrollment_confirm_key_hash TEXT, ' +
      'mfa_enrollment_confirm_request_hash TEXT)',
  )
  sqlite.exec('CREATE TABLE "twoFactor" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE, verified INTEGER NOT NULL DEFAULT 0)')
  sqlite.prepare(
    'INSERT INTO "user" (id, two_factor_enabled, mfa_enrollment_key_hash) VALUES (?, 0, ?)',
  ).run(userId, 'c'.repeat(64))

  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      let values: (string | number | null)[] = []
      return {
        bind(...next: (string | number | null)[]) {
          values = next
          return this
        },
        async first<T>() {
          return (statement.get(...values) ?? null) as T | null
        },
        async run() {
          const result = statement.run(...values)
          return { success: true, meta: { changes: Number(result.changes) } }
        },
      }
    },
  } as unknown as D1Database
  return { db, sqlite, close: () => sqlite.close() }
}

describe('W02 D1 MFA enrollment-confirm store', () => {
  it('reads the secret-free pending/verified projection and preserves a missing factor as null', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentConfirmStore(db)
      await expect(store.read(userId)).resolves.toEqual({
        userEnabled: false,
        confirmationKeyHash: null,
        confirmationRequestHash: null,
        factorVerified: null,
      })
      sqlite.prepare('INSERT INTO "twoFactor" (id, "userId", verified) VALUES (?, ?, 0)')
        .run('factor-1', userId)
      await expect(store.read(userId)).resolves.toEqual({
        userEnabled: false,
        confirmationKeyHash: null,
        confirmationRequestHash: null,
        factorVerified: false,
      })
    } finally {
      close()
    }
  })

  it('writes only the two SHA-256 fingerprints after Better Auth has verified the factor', async () => {
    const { db, sqlite, close } = makeDb()
    try {
      sqlite.prepare('INSERT INTO "twoFactor" (id, "userId", verified) VALUES (?, ?, 1)')
        .run('factor-1', userId)
      sqlite.prepare('UPDATE "user" SET two_factor_enabled = 1 WHERE id = ?').run(userId)
      const store = createD1MfaEnrollmentConfirmStore(db)
      await expect(store.persistConfirmation({ userId, keyHash, requestHash })).resolves.toBe(true)
      const row = sqlite.prepare(
        'SELECT mfa_enrollment_key_hash AS enrollmentKeyHash, ' +
          'mfa_enrollment_confirm_key_hash AS confirmationKeyHash, ' +
          'mfa_enrollment_confirm_request_hash AS confirmationRequestHash ' +
          'FROM "user" WHERE id = ?',
      ).get(userId) as {
        enrollmentKeyHash: string | null
        confirmationKeyHash: string | null
        confirmationRequestHash: string | null
      }
      expect(row).toEqual({
        enrollmentKeyHash: null,
        confirmationKeyHash: keyHash,
        confirmationRequestHash: requestHash,
      })
      await expect(store.read(userId)).resolves.toMatchObject({
        userEnabled: true,
        confirmationKeyHash: keyHash,
        confirmationRequestHash: requestHash,
        factorVerified: true,
      })
    } finally {
      close()
    }
  })

  it('refuses to persist a confirmation marker before a verified factor exists', async () => {
    const { db, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentConfirmStore(db)
      await expect(store.persistConfirmation({ userId, keyHash, requestHash })).resolves.toBe(false)
    } finally {
      close()
    }
  })

  it('rejects malformed subjects and fingerprints before issuing D1 commands', async () => {
    const { db, close } = makeDb()
    try {
      const store = createD1MfaEnrollmentConfirmStore(db)
      await expect(store.read('../user')).rejects.toThrow('invalid MFA enrollment-confirm subject')
      await expect(store.persistConfirmation({
        userId,
        keyHash: 'not-a-hash',
        requestHash,
      })).rejects.toThrow('invalid MFA enrollment-confirm fingerprint')
    } finally {
      close()
    }
  })
})
