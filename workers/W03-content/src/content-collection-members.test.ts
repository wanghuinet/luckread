import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { listCollectionMembers } from './content-collection-members.js'

describe('W03 collection membership / ordering', () => {
  it('widens relationship authority for collection-member edges with unique order slots', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0010_collection_membership_ordering.sql'),
      'utf8',
    )
    expect(migration).toContain("target_type TEXT NOT NULL CHECK (target_type IN ('content', 'series', 'collection'))")
    expect(migration).toContain("relation_type TEXT NOT NULL CHECK (relation_type IN ('reference', 'series-member', 'collection-member'))")
    expect(migration).toContain('position INTEGER')
    expect(migration).toContain('content_relationships_collection_position_unique_idx')
    expect(migration).toContain("'content.collection.attached'")
    expect(migration).toContain("'content.relationship.revoked'")
  })

  it('lists members in deterministic position order with bounded D1 reads', async () => {
    const queries: string[] = []
    const db = {
      prepare(query: string) {
        queries.push(query)
        if (query.includes('FROM content_collections')) {
          return {
            bind: () => ({
              first: async () => ({ id: 'collection_1', version: 4, etag: 'W/"4"' }),
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
                collection_id: 'collection_1',
                content_id: 'content_2',
                content_slug: 'episode-2',
                content_type: 'article',
                content_state: 'PUBLISHED',
                content_title: 'Episode 2',
              }],
            }),
          }),
        }
      },
    } as never

    const result = await listCollectionMembers(db, 'user_1', 'collection_1', null, 10)
    expect(queries).toHaveLength(2)
    expect(result).toMatchObject({
      items: [{
        relationshipId: 'rel_2',
        collectionId: 'collection_1',
        contentId: 'content_2',
        position: 1,
        title: 'Episode 2',
      }],
      collectionVersion: 4,
      collectionEtag: 'W/"4"',
      hasMore: false,
      nextCursor: null,
    })
    expect(queries[1]).toContain('ORDER BY r.position ASC, r.relationship_id ASC')
    expect(queries[1]).toContain('LIMIT ?')
  })

  it('binds member cursors to the owning user and collection', async () => {
    let prepareCalls = 0
    const db = {
      prepare(query: string) {
        prepareCalls += 1
        if (query.includes('FROM content_collections')) {
          return { bind: () => ({ first: async () => ({ id: 'collection_1', version: 4, etag: 'W/"4"' }) }) }
        }
        return {
          bind: () => ({
            all: async () => ({ results: [
              { relationship_id: 'rel_2', position: 1, created_at: '2026-10-07T00:00:00.000Z', updated_at: '2026-10-07T00:00:00.000Z', collection_id: 'collection_1', content_id: 'content_2', content_slug: 'episode-2', content_type: 'article', content_state: 'PUBLISHED', content_title: 'Episode 2' },
              { relationship_id: 'rel_3', position: 2, created_at: '2026-10-07T00:01:00.000Z', updated_at: '2026-10-07T00:01:00.000Z', collection_id: 'collection_1', content_id: 'content_3', content_slug: 'episode-3', content_type: 'article', content_state: 'PUBLISHED', content_title: 'Episode 3' },
            ] }),
          }),
        }
      },
    } as never
    const first = await listCollectionMembers(db, 'user_1', 'collection_1', null, 1)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    await expect(listCollectionMembers(db, 'user_1', 'collection_2', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    await expect(listCollectionMembers(db, 'user_2', 'collection_1', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect(prepareCalls).toBe(2)
  })

  it('keeps mutation runtime behind idempotency, optimistic concurrency and collection scope', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-collection-members.ts'),
      'utf8',
    )
    expect(runtime).toContain('attachCollectionMember')
    expect(runtime).toContain('removeCollectionMember')
    expect(runtime).toContain('reorderCollectionMember')
    expect(runtime).toContain('content_txn_guard')
    expect(runtime).toContain('Idempotency-Key')
    expect(runtime).toContain('WHERE id = ? AND owner_user_id = ? AND version = ? AND etag = ?')
  })
})
