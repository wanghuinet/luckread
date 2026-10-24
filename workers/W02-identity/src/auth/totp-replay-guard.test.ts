import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createOTP } from '@better-auth/utils/otp'
import { consumeTotpTimeStep, matchTotpTimeStep } from './totp-replay-guard.js'

const SECRET = 'luckread-totp-test-secret'
const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const STEP = Math.floor(NOW / 30_000)

const makeSqliteD1 = (userId = 'user-123') => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    'CREATE TABLE "twoFactor" (' +
      'id TEXT PRIMARY KEY, ' +
      'userId TEXT NOT NULL UNIQUE, ' +
      'lastAcceptedTotpTimeStep INTEGER CHECK (' +
      'lastAcceptedTotpTimeStep IS NULL OR lastAcceptedTotpTimeStep >= 0' +
      '))',
  )
  sqlite.prepare(
    'INSERT INTO "twoFactor" (id, userId, lastAcceptedTotpTimeStep) VALUES (?, ?, NULL)',
  ).run('factor-1', userId)

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
          return { meta: { changes: Number(result.changes) } }
        },
      }
    },
  } as unknown as D1Database

  return { db, sqlite, close: () => sqlite.close() }
}

describe('TOTP time-step replay guard', () => {
  it('identifies the exact current accepted step', async () => {
    const code = await createOTP(SECRET).hotp(STEP)
    await expect(matchTotpTimeStep(SECRET, code, NOW)).resolves.toEqual({
      kind: 'matched',
      timeStep: STEP,
    })
  })

  it('identifies an adjacent-window code and returns its actual step', async () => {
    const code = await createOTP(SECRET).hotp(STEP - 1)
    await expect(matchTotpTimeStep(SECRET, code, NOW)).resolves.toEqual({
      kind: 'matched',
      timeStep: STEP - 1,
    })
  })

  it('rejects invalid code shapes and values', async () => {
    await expect(matchTotpTimeStep(SECRET, '000000', NOW)).resolves.toEqual({ kind: 'invalid' })
    await expect(matchTotpTimeStep(SECRET, ' 12345', NOW)).resolves.toEqual({ kind: 'invalid' })
  })

  it('rejects invalid reservation inputs before touching D1', async () => {
    const db = { prepare: () => { throw new Error('must not query') } } as unknown as D1Database
    await expect(consumeTotpTimeStep(db, '', STEP)).rejects.toThrow('invalid TOTP replay-guard input')
    await expect(consumeTotpTimeStep(db, 'user-123', -1)).rejects.toThrow('invalid TOTP replay-guard input')
  })

  it('atomically consumes a step once and rejects replay with real SQLite conditional SQL', async () => {
    const { db, sqlite, close } = makeSqliteD1()
    try {
      expect(await consumeTotpTimeStep(db, 'user-123', STEP)).toBe(true)
      expect(await consumeTotpTimeStep(db, 'user-123', STEP)).toBe(false)
      expect(await consumeTotpTimeStep(db, 'user-123', STEP - 1)).toBe(false)
      expect(await consumeTotpTimeStep(db, 'other-user', STEP + 1)).toBe(false)

      const row = sqlite.prepare(
        'SELECT lastAcceptedTotpTimeStep FROM "twoFactor" WHERE userId = ?',
      ).get('user-123') as { lastAcceptedTotpTimeStep: number | null } | undefined
      expect(row?.lastAcceptedTotpTimeStep).toBe(STEP)
    } finally {
      close()
    }
  })

  it('has one winner when concurrent duplicate calls target the actual SQLite conditional update', async () => {
    const { db, close } = makeSqliteD1()
    try {
      const results = await Promise.all([
        consumeTotpTimeStep(db, 'user-123', STEP),
        consumeTotpTimeStep(db, 'user-123', STEP),
      ])
      expect(results.sort()).toEqual([false, true])
    } finally {
      close()
    }
  })
})
