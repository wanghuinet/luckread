import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_LIST_DEFAULT_LIMIT,
  CREDENTIAL_LIST_MAX_LIMIT,
  CREDENTIAL_LIST_ORDERING,
  CredentialListError,
  encodeCredentialListCursorForTest,
  listCredentials,
} from './credential-list'

function makeDb(rows: unknown[]) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ sql, bindings })
          return {
            async all() {
              return { results: rows }
            },
          }
        },
      }
    },
  } as unknown as D1Database

  return { db, calls }
}

describe('credential-list', () => {
  it('returns only the canonical public projection and preserves deterministic ordering', async () => {
    const { db, calls } = makeDb([
      { id: 'cred-2', kind: 'email', active: 1, created_at: '2026-09-27T10:00:00.000Z', has_more: 0 },
      { id: 'cred-1', kind: 'username', active: 0, created_at: '2026-09-27T09:00:00.000Z', has_more: 0 },
    ])

    const result = await listCredentials(db, {
      actorUserId: 'user-1',
      requestId: 'req-1',
      traceId: 'trace-1',
    })

    expect(result).toEqual({
      data: {
        items: [
          { credentialId: 'cred-2', kind: 'email', active: true },
          { credentialId: 'cred-1', kind: 'username', active: false },
        ],
        nextCursor: null,
        hasMore: false,
      },
      requestId: 'req-1',
      traceId: 'trace-1',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('ORDER BY c.created_at DESC, c.id DESC')
    expect(calls[0].sql).toContain('LIMIT ?')
    expect(calls[0].bindings).toEqual(['user-1', CREDENTIAL_LIST_DEFAULT_LIMIT])
  })

  it('uses the exact contracted default/max limits and opaque cursor binding', async () => {
    const { db, calls } = makeDb([
      { id: 'cred-3', kind: 'phone', active: 1, created_at: '2026-09-27T08:00:00.000Z', has_more: 1 },
    ])

    const first = await listCredentials(db, {
      actorUserId: 'user-1',
      limit: CREDENTIAL_LIST_MAX_LIMIT,
      requestId: 'req-2',
    })

    expect(first.data.hasMore).toBe(true)
    expect(first.data.nextCursor).toBeTruthy()
    expect(first.data.nextCursor).not.toContain('createdAt')
    expect(first.data.nextCursor).not.toContain('cred-3')
    expect(calls[0].bindings).toEqual(['user-1', CREDENTIAL_LIST_MAX_LIMIT])

    const { db: db2, calls: calls2 } = makeDb([
      { id: 'cred-2', kind: 'email', active: 1, created_at: '2026-09-27T07:00:00.000Z', has_more: 0 },
    ])
    const cursor = encodeCredentialListCursorForTest({
      id: 'cred-3',
      created_at: '2026-09-27T08:00:00.000Z',
    })

    await listCredentials(db2, {
      actorUserId: 'user-1',
      cursor,
      limit: 20,
      requestId: 'req-3',
    })

    expect(calls2[0].bindings).toEqual([
      'user-1',
      '2026-09-27T08:00:00.000Z',
      '2026-09-27T08:00:00.000Z',
      'cred-3',
      'user-1',
      '2026-09-27T08:00:00.000Z',
      '2026-09-27T08:00:00.000Z',
      'cred-3',
      20,
    ])
    expect(calls2[0].sql).toContain('EXISTS')
    expect(CREDENTIAL_LIST_ORDERING).toBe('createdAt DESC, credentialId DESC')
  })

  it('rejects malformed, endpoint-mismatched, and out-of-range cursors/limits', async () => {
    const { db } = makeDb([])
    await expect(listCredentials(db, {
      actorUserId: 'user-1',
      cursor: 'not-a-cursor',
      requestId: 'req-4',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' })

    const foreignCursor = Buffer.from(JSON.stringify({
      v: 1,
      endpoint: 'authOtherList',
      ordering: CREDENTIAL_LIST_ORDERING,
      createdAt: '2026-09-27T08:00:00.000Z',
      credentialId: 'cred-9',
    })).toString('base64url')

    await expect(listCredentials(db, {
      actorUserId: 'user-1',
      cursor: foreignCursor,
      requestId: 'req-5',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' })

    await expect(listCredentials(db, {
      actorUserId: 'user-1',
      limit: 101,
      requestId: 'req-6',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    const invalidTimestampCursor = Buffer.from(JSON.stringify({
      v: 1,
      endpoint: 'authCredentialList',
      ordering: CREDENTIAL_LIST_ORDERING,
      createdAt: 'not-a-date',
      credentialId: 'cred-9',
    })).toString('base64url')

    await expect(listCredentials(db, {
      actorUserId: 'user-1',
      cursor: invalidTimestampCursor,
      requestId: 'req-8',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
  })

  it('is structurally self-scoped: no target user identifier is accepted', async () => {
    const { db, calls } = makeDb([])
    const result = await listCredentials(db, {
      actorUserId: 'user-1',
      requestId: 'req-7',
    })

    expect(result.data.items).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0].bindings[0]).toBe('user-1')
  })
})
