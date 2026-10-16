/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listFollowingAuthorIds } from './follow-runtime.js'

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
})
