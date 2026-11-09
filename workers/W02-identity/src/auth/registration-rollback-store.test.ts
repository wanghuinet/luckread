import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'

import { createD1RegistrationRollbackStore } from './registration-rollback-store.js'
import { createPostgresRegistrationRollbackStore } from '../neon/registration-rollback-postgres.js'
import { RegistrationRollbackStoreError } from './registration-rollback-store.js'

type FakeD1Options = {
  user?: { id: string; email: string; username: string | null; accountState: string } | null
  session?: { present: number } | null
}

function fakeD1(options: FakeD1Options = {}) {
  const prepared: Array<{ sql: string; values: unknown[] }> = []
  const batches: string[][] = []
  const db = {
    prepare(sql: string) {
      const call = { sql, values: [] as unknown[] }
      prepared.push(call)
      return {
        sql,
        bind(...values: unknown[]) {
          call.values = values
          return this
        },
        async first<T>() {
          if (sql.includes('FROM "user"')) return (options.user ?? null) as unknown as T | null
          if (sql.includes('FROM "session"')) return (options.session ?? null) as unknown as T | null
          return null
        },
      }
    },
    async batch(statements: Array<{ sql?: string }>) {
      batches.push(statements.map((statement) => statement.sql ?? ''))
      return statements.map(() => ({ meta: { changes: 1 } }))
    },
  } as unknown as D1Database
  return { db, prepared, batches }
}

type FakePgOptions = {
  user?: { id: string; email: string; username: string | null; accountState: string } | null
  session?: boolean
}

function fakePool(options: FakePgOptions = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const client = {
    async query<T>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
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
  it('keeps absent D1 registrations idempotent', async () => {
    const { db, batches } = fakeD1({ user: null })
    await expect(createD1RegistrationRollbackStore(db).rollback(command)).resolves.toEqual({ rolledBack: true })
    expect(batches).toHaveLength(0)
  })

  it('preserves D1 ownership, pending-state and active-session guards', async () => {
    const mismatch = fakeD1({ user: { ...user, email: 'someone-else@example.test' } })
    await expect(createD1RegistrationRollbackStore(mismatch.db).rollback(command))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    const active = fakeD1({ user, session: { present: 1 } })
    await expect(createD1RegistrationRollbackStore(active.db).rollback(command))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(active.batches).toHaveLength(0)
  })

  it('uses the existing atomic D1 batch and normalized email', async () => {
    const { db, prepared, batches } = fakeD1({ user })
    await expect(createD1RegistrationRollbackStore(db).rollback(command)).resolves.toEqual({ rolledBack: true })
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(4)
    expect(batches[0]?.[0]).toContain('DELETE FROM role_assignments')
    expect(batches[0]?.[1]).toContain('DELETE FROM "verification"')
    expect(batches[0]?.[2]).toContain('DELETE FROM "account"')
    expect(batches[0]?.[3]).toContain('DELETE FROM "user"')
    expect(prepared.find((call) => call.sql.includes('DELETE FROM "verification"'))?.values)
      .toEqual(['pending@example.test'])
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
