import { describe, expect, it, vi } from 'vitest'
import {
  ContentLikerReadStoreError,
  type ContentLikerReadInput,
} from './like-list-read-store.js'
import {
  createPostgresContentLikerReadStore,
  type ContentLikerPostgresQueryExecutor,
} from './like-list-read-store-postgres.js'

const input = (overrides: Partial<ContentLikerReadInput> = {}): ContentLikerReadInput => ({
  contentId: 'content-1',
  contentOwnerUserId: 'owner-1',
  viewerUserId: 'viewer-1',
  cursor: null,
  limit: 11,
  ...overrides,
})

describe('W05 PostgreSQL content liker read store', () => {
  it('preserves owner/viewer bidirectional Block policy and stable keyset SQL', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: ContentLikerPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return {
          rows: [{
            relationship_id: 'like-1',
            actor_user_id: 'liker-1',
            created_at: '2026-11-10T04:00:00.000123Z',
          }] as unknown as Row[],
        }
      },
    }
    const store = createPostgresContentLikerReadStore(db)

    await expect(store.list(input({
      cursor: {
        createdAt: '2026-11-10T04:00:00.000456Z',
        relationshipId: 'like-2',
      },
      limit: 2,
    }))).resolves.toEqual([{
      relationship_id: 'like-1',
      actor_user_id: 'liker-1',
      created_at: '2026-11-10T04:00:00.000123Z',
    }])

    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual([
      'content-1',
      'owner-1',
      'owner-1',
      'viewer-1',
      'owner-1',
      'owner-1',
      'viewer-1',
      'viewer-1',
      'viewer-1',
      '2026-11-10T04:00:00.000456Z',
      'like-2',
      2,
    ])
    const sql = calls[0]?.sql ?? ''
    expect(sql).toContain('content_block.relation_type')
    expect(sql).toContain('viewer_block.relation_type')
    expect(sql).toContain('liker_block.relation_type')
    expect(sql).toContain('viewer_block.actor_user_id = $4')
    expect(sql).toContain('viewer_block.target_user_id = $5')
    expect(sql).toContain('liker_block.actor_user_id = $8')
    expect(sql).toContain('liker_block.target_user_id = $9')
    expect(sql).toContain('il.created_at < $10::timestamptz')
    expect(sql).toContain('il.created_at = $10::timestamptz')
    expect(sql).toContain('il.relationship_id < $11')
    expect(sql).toContain('to_char(il.created_at AT TIME ZONE')
    expect(sql).toContain('SS.US')
    expect(sql).toContain('ORDER BY il.created_at DESC, il.relationship_id DESC')
    expect(sql).toContain('LIMIT $12')
    expect(sql).not.toContain('FROM contents')
  })

  it('omits viewer-only Block clauses for an anonymous viewer', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const db = { query } as unknown as ContentLikerPostgresQueryExecutor
    const store = createPostgresContentLikerReadStore(db)

    await store.list(input({ viewerUserId: null, cursor: null, limit: 6 }))

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(values).toEqual(['content-1', 'owner-1', 'owner-1', 6])
    expect(sql).toContain('content_block')
    expect(sql).not.toContain('viewer_block')
    expect(sql).not.toContain('liker_block')
  })

  it('maps provider failures to a sanitized 503', async () => {
    const db: ContentLikerPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('secret-postgres-host-and-driver-detail')
      },
    }
    const store = createPostgresContentLikerReadStore(db)

    await expect(store.list(input())).rejects.toBeInstanceOf(ContentLikerReadStoreError)
    await expect(store.list(input())).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'CONTENT_LIKER_READ_UNAVAILABLE',
    })
  })
})
