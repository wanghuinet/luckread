import { describe, expect, it, vi } from 'vitest'
import { isActiveMfaSubject } from './mfa-challenge-account-state.js'

const makeDb = (row: unknown) => {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(row),
  }
  return {
    db: { prepare: vi.fn(() => statement) } as unknown as D1Database,
    statement,
  }
}

describe('MFA challenge account-state gate', () => {
  it('allows only an authoritative ACTIVE W02 account', async () => {
    const active = makeDb({ accountState: 'ACTIVE' })
    await expect(isActiveMfaSubject(active.db, 'user-12345678')).resolves.toBe(true)
    expect(active.statement.bind).toHaveBeenCalledWith('user-12345678')

    for (const row of [
      { accountState: 'PENDING_VERIFICATION' },
      { accountState: 'SUSPENDED' },
      { accountState: 'DELETED' },
      null,
    ]) {
      const db = makeDb(row)
      await expect(isActiveMfaSubject(db.db, 'user-12345678')).resolves.toBe(false)
    }
  })

  it('fails closed on invalid subject ids and database read errors', async () => {
    const db = makeDb({ accountState: 'ACTIVE' })
    await expect(isActiveMfaSubject(db.db, '')).rejects.toThrow()
    const failed = { prepare: vi.fn(() => ({ bind: () => ({ first: () => Promise.reject(new Error('D1 unavailable')) }) })) }
    await expect(isActiveMfaSubject(failed as unknown as D1Database, 'user-12345678')).rejects.toThrow('D1 unavailable')
  })
})
