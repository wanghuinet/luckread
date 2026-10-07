import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { listSeriesMembers } from './content-series-members.js'

describe('W03 series membership / ordering', () => {
  it('widens relationship authority for series-member edges with unique order slots', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0008_series_membership_ordering.sql'),
      'utf8',
    )
    expect(migration).toContain("target_type TEXT NOT NULL CHECK (target_type IN ('content', 'series'))")
    expect(migration).toContain("relation_type TEXT NOT NULL CHECK (relation_type IN ('reference', 'series-member'))")
    expect(migration).toContain('position INTEGER')
    expect(migration).toContain('content_relationships_series_position_unique_idx')
    expect(migration).toContain("'content.series.attached'")
    expect(migration).toContain("'content.relationship.revoked'")
  })

  it('lists members in deterministic position order with bounded D1 reads', async () => {
    const queries: string[] = []
    const db = {
      prepare(query: string) {
        queries.push(query)
        if (query.includes('FROM content_series')) {
          return {
            bind: () => ({
              first: async () => ({ id: 'series_1', version: 4, etag: 'W/"4"' }),
            }),
          }
        }
        return {
          bind: () => ({
            all: async () => ({
              results: [{
                relationship_id: 'rel_2',
                position: 1,
                created_at: '2026-10-07T00:00:00.000Z',
                updated_at: '2026-10-07T00:00:00.000Z',
                series_id: 'series_1',
                content_id: 'content_2',
                content_slug: 'episode-2',
                content_type: 'article',
                content_state: 'PUBLISHED',
                title: 'Episode 2',
              }],
            }),
          }),
        }
      },
    } as never

    const result = await listSeriesMembers(db, 'user_1', 'series_1', null, 10)
    expect(queries).toHaveLength(2)
    expect(result).toMatchObject({
      items: [{
        relationshipId: 'rel_2',
        seriesId: 'series_1',
        contentId: 'content_2',
        position: 1,
        title: 'Episode 2',
      }],
      seriesVersion: 4,
      seriesEtag: 'W/"4"',
      hasMore: false,
      nextCursor: null,
    })
    expect(queries[1]).toContain('ORDER BY r.position ASC, r.relationship_id ASC')
    expect(queries[1]).toContain('LIMIT ?')
  })

  it('keeps mutation runtime behind idempotency, optimistic concurrency and series scope', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-series-members.ts'),
      'utf8',
    )
    expect(runtime).toContain('attachSeriesMember')
    expect(runtime).toContain('removeSeriesMember')
    expect(runtime).toContain('reorderSeriesMember')
    expect(runtime).toContain('content_txn_guard')
    expect(runtime).toContain('Idempotency-Key')
    expect(runtime).toContain('WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?')
  })
})
