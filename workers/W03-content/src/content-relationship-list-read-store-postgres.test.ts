import { describe, expect, it, vi } from 'vitest'

import { createPostgresContentRelationshipListReadStore } from './content-relationship-list-read-store-postgres.js'
import type { ContentRelationshipListPostgresQueryExecutor } from './content-relationship-list-read-store-postgres.js'

describe('PostgreSQL content relationship list reader', () => {
  const row = {
    relationship_id: 'relationship_1',
    relation_type: 'reference' as const,
    created_at: new Date('2026-11-16T12:00:00.000Z'),
    related_id: 'content_2',
    related_slug: 'related-content',
    related_type: 'article' as const,
    related_title: 'Related content',
    relation_direction: 'out' as const,
  }

  it('filters active references between published contents and maps timestamp/direction', async () => {
    const query = vi.fn(async () => ({ rows: [row] }))
    const store = createPostgresContentRelationshipListReadStore({
      query,
    } as unknown as ContentRelationshipListPostgresQueryExecutor)

    await expect(store.list('content_1', 'out', null, 21)).resolves.toEqual([{
      relationshipId: 'relationship_1',
      relationType: 'reference',
      direction: 'out',
      relatedContent: {
        id: 'content_2',
        slug: 'related-content',
        contentType: 'article',
        title: 'Related content',
      },
      createdAt: '2026-11-16T12:00:00.000Z',
    }])
    const [sql, values] = query.mock.calls[0] ?? []
    expect(sql).toContain("r.status = 'ACTIVE'")
    expect(sql).toContain("r.relation_type = 'reference'")
    expect(sql).toContain("s.state = 'PUBLISHED'")
    expect(sql).toContain("t.state = 'PUBLISHED'")
    expect(sql).toContain("($2::text = 'out' AND r.source_id = $1)")
    expect(sql).toContain('ORDER BY r.created_at DESC, r.relationship_id DESC')
    expect(values).toEqual(['content_1', 'out', 21])
  })

  it('supports in and both directions with a stable keyset cursor', async () => {
    const query = vi.fn(async () => ({ rows: [{ ...row, relation_direction: 'in' as const }] }))
    const store = createPostgresContentRelationshipListReadStore({
      query,
    } as unknown as ContentRelationshipListPostgresQueryExecutor)
    const cursor = { createdAt: '2026-11-15T00:00:00.000Z', relationshipId: 'relationship_0' }

    await store.list('content_1', 'both', cursor, 11)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(sql).toContain("($2::text = 'in' AND r.target_id = $1)")
    expect(sql).toContain("($2::text = 'both' AND (r.source_id = $1 OR r.target_id = $1))")
    expect(sql).toContain('r.created_at < $3::timestamptz')
    expect(sql).toContain('r.relationship_id < $4::text')
    expect(sql).toContain('LIMIT $5')
    expect(values).toEqual([
      'content_1',
      'both',
      cursor.createdAt,
      cursor.relationshipId,
      11,
    ])
  })

  it('rejects invalid IDs, directions, limits and cursors before querying', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const store = createPostgresContentRelationshipListReadStore({
      query,
    } as unknown as ContentRelationshipListPostgresQueryExecutor)

    await expect(store.list('', 'out', null, 20))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(store.list('content_1', 'sideways' as never, null, 20))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(store.list('content_1', 'out', null, 52))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(store.list('content_1', 'out', { createdAt: 'not-a-date', relationshipId: 'rel_1' }, 20))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(query).not.toHaveBeenCalled()
  })

  it('fails closed without exposing PostgreSQL connection details', async () => {
    const store = createPostgresContentRelationshipListReadStore({
      query: vi.fn(async () => { throw new Error('postgres://secret/database') }),
    } as unknown as ContentRelationshipListPostgresQueryExecutor)

    await expect(store.list('content_1', 'out', null, 10))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
