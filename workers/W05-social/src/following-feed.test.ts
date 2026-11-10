/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listFollowingAuthorIds } from './follow-runtime.js'
import { createPostgresFollowingAuthorIdsReadStore } from './following-author-ids-read-store-postgres.js'
import type { FollowingAuthorIdsPostgresQueryExecutor } from './following-author-ids-read-store-postgres.js'

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({
  user_id: 'creator-' + String(index + 1),
}))

const mockDb = (resultRows: Array<{ user_id: string }>) => {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...values: unknown[]) => ({
      all: vi.fn(async () => ({ results: resultRows })),
      values,
      sql,
    })),
  }))
  return { db: { prepare } as unknown as D1Database, prepare }
}

describe('W05 following feed author candidates', () => {
  it('returns followed-author IDs and applies block/mute exclusions without reading contents', async () => {
    const { db, prepare } = mockDb(rows(3))
    const result = await listFollowingAuthorIds(db, 'viewer-1')
    expect(result).toEqual({
      items: [{ userId: 'creator-1' }, { userId: 'creator-2' }, { userId: 'creator-3' }],
      candidateWindowTruncated: false,
    })
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toContain('social_follow_relationships')
    expect(sql).toContain("b.relation_type = 'block'")
    expect(sql).toContain("m.relation_type = 'mute'")
    expect(sql).not.toContain('FROM contents')
    expect(sql).toContain('LIMIT ?')
  })

  it('signals when the 500-author window is truncated rather than implying completeness', async () => {
    const { db } = mockDb(rows(501))
    const result = await listFollowingAuthorIds(db, 'viewer-1')
    expect(result.items).toHaveLength(500)
    expect(result.candidateWindowTruncated).toBe(true)
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
        items: [
          { userId: 'creator-1' },
          { userId: 'creator-2' },
          { userId: 'creator-3' },
        ],
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
      async query<Row extends Record<string, unknown>>() {
        return { rows: rows(501) as unknown as Row[] }
      },
    }

    const result = await listFollowingAuthorIds(createPostgresFollowingAuthorIdsReadStore(db), 'viewer-1')
    expect(result.items).toHaveLength(500)
    expect(result.items[0]).toEqual({ userId: 'creator-1' })
    expect(result.items[499]).toEqual({ userId: 'creator-500' })
    expect(result.candidateWindowTruncated).toBe(true)
  })

  it('maps PostgreSQL author candidate read failures to a sanitized 503', async () => {
    const db: FollowingAuthorIdsPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('secret-driver-detail')
      },
    }

    await expect(listFollowingAuthorIds(createPostgresFollowingAuthorIdsReadStore(db), 'viewer-1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

})
