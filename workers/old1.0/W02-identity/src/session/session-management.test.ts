import { describe, expect, it } from 'vitest'
import {
  SessionManagementError,
  listCurrentUserSessions,
  revokeCurrentUserSession,
} from './session-management.js'

const NOW = '2026-09-29T06:00:00.000Z'

function listDb(
  rows: Array<Record<string, unknown>>,
  authorization: { permissionAllowed: number; currentSessionValid: number } = {
    permissionAllowed: 1,
    currentSessionValid: 1,
  },
) {
  const seenSql: string[] = []
  const seenArgs: unknown[][] = []
  const db = {
    prepare: (sql: string) => {
      seenSql.push(sql)
      return {
        bind: (...args: unknown[]) => {
          seenArgs.push(args)
          return {
            all: async <T>() => ({ results: rows as T[] }),
            first: async <T>() => ({ ...authorization, targetOwned: 1 } as T),
          }
        },
      }
    },
    getSeen: () => ({ seenSql, seenArgs }),
  }
  return db as unknown as D1Database & { getSeen: () => { seenSql: string[]; seenArgs: unknown[][] } }
}

describe('AUTH-010 session list', () => {
  it('returns privacy-safe bounded sessions and an opaque next cursor', async () => {
    const db = listDb([
      {
        sessionId: 'sid-2',
        deviceId: 'device-2',
        createdAt: '2026-09-29T05:00:00.000Z',
        expiresAt: '2026-09-30T05:00:00.000Z',
        lastSeenAt: NOW,
      },
      {
        sessionId: 'sid-1',
        deviceId: 'device-1',
        createdAt: '2026-09-29T04:00:00.000Z',
        expiresAt: '2026-09-30T04:00:00.000Z',
        lastSeenAt: null,
      },
    ])

    const result = await listCurrentUserSessions(db, {
      userId: '42',
      currentSessionId: 'sid-2',
      tokenVersion: 3,
      limit: 1,
      now: NOW,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({
      sessionId: 'sid-2',
      deviceId: 'device-2',
      createdAt: '2026-09-29T05:00:00.000Z',
      expiresAt: '2026-09-30T05:00:00.000Z',
      lastSeenAt: NOW,
    })
    expect(typeof result.nextCursor).toBe('string')
    expect(result.nextCursor).not.toContain('42')

    const sql = db.getSeen().seenSql
    expect(sql.some((statement) => statement.includes('role_assignments'))).toBe(true)
    expect(sql.some((statement) => statement.includes('current_state.token_version = ?'))).toBe(true)
  })

  it('rejects malformed cursors before database execution', async () => {
    const db = listDb([])
    await expect(listCurrentUserSessions(db, {
      userId: '42',
      currentSessionId: 'sid-2',
      tokenVersion: 3,
      cursor: 'not-a-valid-cursor',
      now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' } satisfies Partial<SessionManagementError>)
  })

  it('fails closed when the current tokenVersion no longer matches the authoritative session', async () => {
    const db = listDb([], { permissionAllowed: 1, currentSessionValid: 0 })

    await expect(listCurrentUserSessions(db, {
      userId: '42',
      currentSessionId: 'sid-2',
      tokenVersion: 3,
      now: NOW,
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' } satisfies Partial<SessionManagementError>)
  })
})

describe('AUTH-010 session revoke', () => {
  it('checks current-session validity and ownership before the atomic revoke batch', async () => {
    const batchCalls: string[][] = []
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async <T>() => ({
            permissionAllowed: 1,
            currentSessionValid: 1,
            targetOwned: 1,
          } as T),
          sql,
          args,
        }),
      }),
      batch: async (statements: Array<{ sql?: string; args?: unknown[] }>) => {
        batchCalls.push(statements.map((statement) => statement.sql ?? ''))
        return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }]
      },
    } as unknown as D1Database

    await expect(revokeCurrentUserSession(db, {
      userId: '42',
      currentSessionId: 'sid-current',
      tokenVersion: 3,
      targetSessionId: 'sid-target',
      now: NOW,
    })).resolves.toEqual({ revoked: true })

    expect(batchCalls).toHaveLength(1)
    expect(batchCalls[0][0]).toContain('UPDATE auth_session_state')
    expect(batchCalls[0][0]).toContain('user_id = ?')
    expect(batchCalls[0][1]).toContain('DELETE FROM "session"')
    expect(batchCalls[0][1]).toContain('CAST(user_id AS TEXT) = ?')
  })

  it('fails closed when target session is not owned', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async <T>() => ({
            permissionAllowed: 1,
            currentSessionValid: 1,
            targetOwned: 0,
          } as T),
        }),
      }),
      batch: async () => {
        throw new Error('must not mutate')
      },
    } as unknown as D1Database

    await expect(revokeCurrentUserSession(db, {
      userId: '42',
      currentSessionId: 'sid-current',
      tokenVersion: 3,
      targetSessionId: 'sid-other',
      now: NOW,
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' } satisfies Partial<SessionManagementError>)
  })
})
