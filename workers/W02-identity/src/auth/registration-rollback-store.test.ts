import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'

import { createPostgresRegistrationRollbackStore } from '../neon/registration-rollback-postgres.js'
import { RegistrationRollbackStoreError } from './registration-rollback-store.js'

type FakePgOptions = {
  user?: { id: string; email: string; username: string | null; accountState: string } | null
  session?: boolean
}

function fakePool(options: FakePgOptions = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const client = {
    async query<T>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (sql.includes('FROM "user"') && sql.includes('OR email = $2')) {
        const rows = options.user && (
          options.user.id === values[0] || options.user.email === values[1]
        ) ? [{
          id: options.user.id,
          email: options.user.email,
          username: options.user.username,
        }] : []
        return { rows, rowCount: rows.length } as unknown as T
      }
      if (sql.includes('FROM "user"')) {
        const rows = options.user ? [options.user] : []
        return { rows, rowCount: rows.length } as unknown as T
      }
      if (sql.includes('FROM "session"')) {
        const rows = options.session ? [{ id: 'active-session' }] : []
        return { rows, rowCount: rows.length } as unknown as T
      }
      if (sql.startsWith('DELETE FROM "user"')) return { rows: [], rowCount: 1 } as unknown as T
      return { rows: [], rowCount: 1 } as unknown as T
    },
    release() {},
  }
  const pool = {
    async query<T>(sql: string, values: unknown[] = []) {
      return client.query<T>(sql, values)
    },
    async connect() { return client },
  } as unknown as Pool
  return { pool, calls }
}

const command = {
  userId: 'pending-user-0001',
  email: ' PENDING@EXAMPLE.TEST ',
  username: ' pending_user ',
}

const user = {
  id: 'pending-user-0001',
  email: 'pending@example.test',
  username: 'pending_user',
  accountState: 'PENDING_VERIFICATION',
}

describe('W02 registration rollback store', () => {
  it('confirms the user only through the Neon Postgres rollback authority store', async () => {
    const { pool, calls } = fakePool({ user })
    const identity = { id: user.id, email: user.email, username: user.username }
    await expect(createPostgresRegistrationRollbackStore(pool).confirmIdentity({
      userId: user.id,
      email: ' PENDING@EXAMPLE.TEST ',
    })).resolves.toEqual({
      identityById: identity,
      identityByEmailId: user.id,
    })
    expect(calls).toEqual([{
      sql: 'SELECT id, email, username FROM "user" WHERE id = $1 OR email = $2',
      values: [user.id, 'pending@example.test'],
    }])
  })

  it('rejects invalid registration identity confirmation before database access', async () => {
    const { pool, calls } = fakePool({ user })
    await expect(createPostgresRegistrationRollbackStore(pool).confirmIdentity({
      userId: '',
      email: 'pending@example.test',
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(calls).toHaveLength(0)
  })

  it('executes PostgreSQL rollback atomically and in the same delete order', async () => {
    const { pool, calls } = fakePool({ user })
    await expect(createPostgresRegistrationRollbackStore(pool).rollback(command))
      .resolves.toEqual({ rolledBack: true })
    expect(calls.map((call) => call.sql.trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'DELETE',
      'DELETE',
      'DELETE',
      'DELETE',
      'COMMIT',
    ])
    expect(calls.find((call) => call.sql.includes('DELETE FROM "verification"'))?.values)
      .toEqual(['pending@example.test'])
    expect(calls.some((call) => call.sql.includes('FOR UPDATE'))).toBe(true)
  })

  it('rolls back PostgreSQL changes when an active session exists', async () => {
    const { pool, calls } = fakePool({ user, session: true })
    await expect(createPostgresRegistrationRollbackStore(pool).rollback(command))
      .rejects.toBeInstanceOf(RegistrationRollbackStoreError)
    expect(calls.some((call) => call.sql === 'ROLLBACK')).toBe(true)
    expect(calls.some((call) => call.sql.startsWith('DELETE FROM'))).toBe(false)
  })

  it('commits an idempotent PostgreSQL rollback when the user is already absent', async () => {
    const { pool, calls } = fakePool({ user: null })
    await expect(createPostgresRegistrationRollbackStore(pool).rollback(command))
      .resolves.toEqual({ rolledBack: true })
    expect(calls.map((call) => call.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FROM "user"'),
      'COMMIT',
    ])
  })

  it('rejects malformed commands before any database access', async () => {
    const { pool, calls } = fakePool({ user })
    await expect(createPostgresRegistrationRollbackStore(pool).rollback({
      ...command,
      userId: '',
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(calls).toHaveLength(0)
  })
})
