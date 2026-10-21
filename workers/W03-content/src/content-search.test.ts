import { describe, expect, it } from 'vitest'
import worker from './index.js'
import { decodeScopedCursor, searchPublishedContents } from './content-runtime.js'

const contentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'content_1',
  content_type: 'post',
  owner_user_id: 'user_1',
  creator_id: 'user_1',
  ip_id: null,
  state: 'PUBLISHED',
  scheduled_at: null,
  version: 1,
  revision: 1,
  slug: 'luckread-launch',
  title: 'LuckRead launch',
  body_ref: 'body_1',
  media_refs_json: '[]',
  cover_ref: null,
  etag: 'W/"1"',
  created_at: '2026-10-20T00:00:00.000Z',
  updated_at: '2026-10-20T00:00:00.000Z',
  ...overrides,
})

function mockDb(rows: Record<string, unknown>[]) {
  let query = ''
  let bindings: unknown[] = []
  const db = {
    prepare(sql: string) {
      query = sql
      return {
        bind(...values: unknown[]) {
          bindings = values
          return { all: async () => ({ results: rows }) }
        },
      }
    },
  }
  return {
    db: db as never,
    readQuery: () => query,
    readBindings: () => bindings,
  }
}

describe('W03 published content search', () => {
  it('searches only published title/slug metadata and binds pagination to the query', async () => {
    const rows = [
      contentRow(),
      contentRow({
        id: 'content_2',
        slug: 'luckread-mobile',
        title: 'LuckRead mobile',
        created_at: '2026-10-19T00:00:00.000Z',
      }),
    ]
    const mock = mockDb(rows)
    const firstPage = await searchPublishedContents(mock.db, 'LuckRead', null, 1)

    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.items[0]?.id).toBe('content_1')
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(mock.readQuery()).toContain("state = 'PUBLISHED'")
    expect(mock.readQuery()).toContain('instr(lower(title), lower(?))')
    expect(mock.readQuery()).toContain('instr(lower(slug), lower(?))')
    expect(mock.readQuery()).toContain('ORDER BY created_at DESC, id DESC')
    expect(mock.readBindings()).toEqual(['LuckRead', 'LuckRead', 2])

    const cursor = decodeScopedCursor(
      firstPage.nextCursor!,
      JSON.stringify({ type: 'published-content-search', query: 'luckread' }),
    )
    expect(cursor).toEqual({ updatedAt: '2026-10-20T00:00:00.000Z', id: 'content_1' })

    await expect(searchPublishedContents(mock.db, 'other query', firstPage.nextCursor, 1))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
  })

  it('rejects an empty or oversized query', async () => {
    const mock = mockDb([])
    await expect(searchPublishedContents(mock.db, '   ', null, 20))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(searchPublishedContents(mock.db, 'x'.repeat(257), null, 20))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('allows only authenticated W04 transport to use the internal search route', async () => {
    const mock = mockDb([contentRow()])
    const env = { D1_02: mock.db }
    const request = (headers: Record<string, string>) => new Request(
      'https://luckread-w03.internal/internal/content/search',
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ q: 'LuckRead', cursor: null, limit: 20 }),
      },
    )
    const untrusted = await worker.fetch(request({
      'X-LuckRead-Caller': 'browser',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'search-denied',
    }), env as never)
    expect(untrusted.status).toBe(403)

    const allowed = await worker.fetch(request({
      'X-LuckRead-Caller': 'W04',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'search-allowed',
    }), env as never)
    expect(allowed.status).toBe(200)
    const payload = await allowed.json() as {
      data: { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string | null }
    }
    expect(payload).toMatchObject({
      data: { items: [{ id: 'content_1', title: 'LuckRead launch' }], hasMore: false, nextCursor: null },
    })
    expect(payload.data.items[0]).not.toHaveProperty('bodyRef')
    expect(payload.data.items[0]).not.toHaveProperty('mediaRefs')
    expect(payload.data.items[0]).not.toHaveProperty('coverRef')
  })

  it('does not forward credential-bearing requests or accept extra body fields', async () => {
    const mock = mockDb([contentRow()])
    const headers = {
      'X-LuckRead-Caller': 'W04',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'search-credential-denied',
      Authorization: 'Bearer untrusted',
      'content-type': 'application/json',
    }
    const denied = await worker.fetch(new Request(
      'https://luckread-w03.internal/internal/content/search',
      { method: 'POST', headers, body: JSON.stringify({ q: 'LuckRead', limit: 20 }) },
    ), { D1_02: mock.db } as never)
    expect(denied.status).toBe(403)

    const invalid = await worker.fetch(new Request(
      'https://luckread-w03.internal/internal/content/search',
      {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W04',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'search-extra-field',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ q: 'LuckRead', limit: 20, includeDrafts: true }),
      },
    ), { D1_02: mock.db } as never)
    expect(invalid.status).toBe(422)
  })
})
