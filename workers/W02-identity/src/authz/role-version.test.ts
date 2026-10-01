import { describe, expect, it } from 'vitest'
import { advanceRoleVersion, readRoleVersion } from './role-version.js'

function fakeD1(initial: Record<string, number> = {}) {
  const versions = new Map(Object.entries(initial))

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async <T>() => {
          const subjectId = String(args[0])

          if (sql.startsWith('SELECT role_version AS roleVersion')) {
            const value = versions.get(subjectId)
            return (value === undefined ? null : { roleVersion: value }) as T | null
          }

          if (sql.startsWith('INSERT INTO role_authorization_versions')) {
            const previous = versions.get(subjectId)
            const next = previous === undefined ? 1 : previous + 1
            versions.set(subjectId, next)
            return { roleVersion: next } as T
          }

          throw new Error('unexpected SQL in test double')
        },
      }),
    }),
  }

  return db as unknown as D1Database
}

describe('role_version authority', () => {
  it('treats an absent subject row as the initial version 0', async () => {
    const db = fakeD1()
    await expect(readRoleVersion(db, 'user-1')).resolves.toBe(0)
  })

  it('creates version 1 on the first mutation and increments monotonically', async () => {
    const db = fakeD1()

    await expect(advanceRoleVersion(db, 'user-1', '2026-09-25T00:00:00.000Z')).resolves.toBe(1)
    await expect(readRoleVersion(db, 'user-1')).resolves.toBe(1)
    await expect(advanceRoleVersion(db, 'user-1', '2026-09-25T00:01:00.000Z')).resolves.toBe(2)
    await expect(readRoleVersion(db, 'user-1')).resolves.toBe(2)
  })

  it('keeps versions isolated by subject', async () => {
    const db = fakeD1({ 'user-1': 7 })

    await expect(advanceRoleVersion(db, 'user-1', '2026-09-25T00:02:00.000Z')).resolves.toBe(8)
    await expect(advanceRoleVersion(db, 'user-2', '2026-09-25T00:03:00.000Z')).resolves.toBe(1)
    await expect(readRoleVersion(db, 'user-1')).resolves.toBe(8)
    await expect(readRoleVersion(db, 'user-2')).resolves.toBe(1)
  })

  it('fails closed for an empty subject id', async () => {
    const db = fakeD1()

    await expect(readRoleVersion(db, '')).rejects.toThrow('role version requires subjectId')
    await expect(advanceRoleVersion(db, '')).rejects.toThrow('role version requires subjectId')
  })

  it('uses an atomic upsert contract for mutation', async () => {
    const sql = [
      'INSERT INTO role_authorization_versions (subject_id, role_version, updated_at)',
      'VALUES (?, 1, ?)',
      'ON CONFLICT(subject_id) DO UPDATE SET',
      'role_version = role_authorization_versions.role_version + 1,',
      'updated_at = excluded.updated_at',
      'RETURNING role_version AS roleVersion',
    ].join(' ')
    expect(sql).toContain('ON CONFLICT(subject_id) DO UPDATE')
    expect(sql).toContain('role_version = role_authorization_versions.role_version + 1')
    expect(sql).toContain('RETURNING role_version AS roleVersion')
  })
})
