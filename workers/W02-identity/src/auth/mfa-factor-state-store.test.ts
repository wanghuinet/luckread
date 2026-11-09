import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createD1MfaFactorStateStore } from './mfa-factor-state-store.js'

const makeD1 = () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    'CREATE TABLE "user" (id TEXT PRIMARY KEY, account_state TEXT NOT NULL)',
  )
  sqlite.exec(
    'CREATE TABLE "twoFactor" (' +
      'id TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE, secret TEXT NOT NULL, ' +
      'backupCodes TEXT NOT NULL, lockedUntil TEXT, lastAcceptedTotpTimeStep INTEGER)',
  )
  sqlite.prepare('INSERT INTO "user" (id, account_state) VALUES (?, ?)').run('user-12345678', 'ACTIVE')
  sqlite.prepare(
    'INSERT INTO "twoFactor" (id, userId, secret, backupCodes, lockedUntil, lastAcceptedTotpTimeStep) ' +
      'VALUES (?, ?, ?, ?, ?, NULL)',
  ).run('factor-1', 'user-12345678', 'encrypted-totp-ciphertext', 'encrypted-recovery-codes',
    '2026-11-09T12:05:00.000Z')

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
          return (statement.get(...values) as T | undefined) ?? null
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

describe('MFA factor-state persistence port', () => {
  it('keeps production account-state reads on the existing D1 authority', async () => {
    const { db, sqlite, close } = makeD1()
    try {
      const store = createD1MfaFactorStateStore(db)
      await expect(store.isActiveSubject('user-12345678')).resolves.toBe(true)
      sqlite.prepare('UPDATE "user" SET account_state = ? WHERE id = ?')
        .run('SUSPENDED', 'user-12345678')
      await expect(store.isActiveSubject('user-12345678')).resolves.toBe(false)
      await expect(store.isActiveSubject('missing-user-12345678')).resolves.toBe(false)
    } finally {
      close()
    }
  })

  it('exposes only the encrypted TOTP secret and lockout timestamp', async () => {
    const { db, close } = makeD1()
    try {
      const store = createD1MfaFactorStateStore(db)
      const material = await store.readVerificationMaterial('user-12345678')
      expect(material).toEqual({
        encryptedSecret: 'encrypted-totp-ciphertext',
        lockedUntil: '2026-11-09T12:05:00.000Z',
      })
      expect(Object.keys(material ?? {}).sort()).toEqual(['encryptedSecret', 'lockedUntil'])
      expect(JSON.stringify(material)).not.toContain('encrypted-recovery-codes')
      await expect(store.readVerificationMaterial('missing-user-12345678')).resolves.toBeNull()
    } finally {
      close()
    }
  })

  it('reserves one monotonically increasing TOTP step exactly once', async () => {
    const { db, close } = makeD1()
    try {
      const store = createD1MfaFactorStateStore(db)
      const step = 8_000_000
      const results = await Promise.all([
        store.consumeTotpTimeStep('user-12345678', step),
        store.consumeTotpTimeStep('user-12345678', step),
      ])
      expect(results.sort()).toEqual([false, true])
      await expect(store.consumeTotpTimeStep('user-12345678', step - 1)).resolves.toBe(false)
      await expect(store.consumeTotpTimeStep('user-12345678', step)).resolves.toBe(false)
      await expect(store.consumeTotpTimeStep('user-12345678', step + 1)).resolves.toBe(true)
    } finally {
      close()
    }
  })

  it('rejects invalid factor subjects without querying storage', async () => {
    const { db, sqlite, close } = makeD1()
    try {
      const store = createD1MfaFactorStateStore(db)
      await expect(store.readVerificationMaterial('')).rejects.toThrow('invalid MFA factor subject')
      await expect(store.readVerificationMaterial('bad/user')).rejects.toThrow('invalid MFA factor subject')
      await expect(store.isActiveSubject('')).rejects.toThrow('invalid MFA challenge subject')
      await expect(store.consumeTotpTimeStep('user-12345678', -1)).rejects.toThrow('invalid TOTP replay-guard input')
      const rows = sqlite.prepare('SELECT COUNT(*) AS count FROM "twoFactor"').get() as { count: number }
      expect(rows.count).toBe(1)
    } finally {
      close()
    }
  })
})
