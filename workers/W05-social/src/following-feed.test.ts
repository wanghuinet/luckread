/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listFollowingAuthorIds } from './follow-runtime.js'
import type { FollowingAuthorIdsReadStore } from './following-author-ids-read-store.js'
import { createPostgresFollowingAuthorIdsReadStore } from './following-author-ids-read-store-postgres.js'
import type { FollowingAuthorIdsPostgresQueryExecutor } from './following-author-ids-read-store-postgres.js'

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({
  user_id: 'creator-' + String(index + 1),
}))

describe('W05 following feed author candidates', () => {
  it('uses the injected Store and preserves the bounded author-only result contract', async () => {
    const store: FollowingAuthorIdsReadStore = {
      list: vi.fn(async () => rows(3)),
    }
    await expect(listFollowingAuthorIds(store, 'viewer-1')).resolves.toEqual({
      items: [{ userId: 'creator-1' }, { userId: 'creator-2' }, { userId: 'creator-3' }],
      candidateWindowTruncated: false,
    })
    expect(store.list).toHaveBeenCalledWith('viewer-1', 501)
  })

  it('signals when the 500-author window is truncated rather than implying completeness', async () => {
    const store: FollowingAuthorIdsReadStore = { list: vi.fn(async () => rows(501)) }
    const result = await listFollowingAuthorIds(store, 'viewer-1')
    expect(result.items).toHaveLength(500)
    expect(result.candidateWindowTruncated).toBe(true)
    expect(store.list).toHaveBeenCalledWith('viewer-1', 501)
  })

  it('runs the PostgreSQL candidate query with bidirectional Block and viewer-directed Mute filters', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: FollowingAuthorIdsPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: rows(3) as unknown as Row[] }
      },
    }
    await expect(listFollowingAuthorIds(createPostgresFollowingAuthorIdsReadStore(db), 'viewer-1'))
      .resolves.toEqual({
        items: [{ userId: 'creator-1' }, { userId: 'creator-2' }, { userId: 'creator-3' }],
        candidateWindowTruncated: false,
      })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['viewer-1', 501])
    const sql = calls[0]?.sql ?? ''
    expect(sql).toContain('f.follower_user_id = $1')
    expect(sql).toContain("b.relation_type = 'block'")
    expect(sql).toContain('(b.actor_user_id = $1 AND b.target_user_id = f.target_user_id)')
    expect(sql).toContain('(b.actor_user_id = f.target_user_id AND b.target_user_id = $1)')
    expect(sql).toContain("m.relation_type = 'mute'")
    expect(sql).toContain('m.actor_user_id = $1')
    expect(sql).toContain('m.target_user_id = f.target_user_id')
    expect(sql).not.toContain('m.actor_user_id = f.target_user_id')
    expect(sql).toContain('ORDER BY f.created_at DESC, f.target_user_id DESC')
    expect(sql).toContain('LIMIT $2')
    expect(sql).not.toContain('FROM contents')
  })

  it('keeps the PostgreSQL author candidate window capped at 500 and reports truncation', async () => {
    const db: FollowingAuthorIdsPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() { return { rows: rows(501) as unknown as Row[] } },
    }
    const result = await listFollowingAuthorIds(createPostgresFollowingAuthorIdsReadStore(db), 'viewer-1')
    expect(result.items).toHaveLength(500)
    expect(result.items[0]).toEqual({ userId: 'creator-1' })
    expect(result.items[499]).toEqual({ userId: 'creator-500' })
    expect(result.candidateWindowTruncated).toBe(true)
  })

  it('maps PostgreSQL author candidate read failures to a sanitized 503', async () => {
    const db: FollowingAuthorIdsPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() { throw new Error('secret-driver-detail') },
    }
    await expect(listFollowingAuthorIds(createPostgresFollowingAuthorIdsReadStore(db), 'viewer-1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
