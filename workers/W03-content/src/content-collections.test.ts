import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { listCreatorCollection } from './content-collection.js'

describe('W03 collection foundation', () => {
  it('defines authoritative collection persistence and lifecycle event triggers', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0009_content_collections.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_collections')
    expect(migration).toContain('creator_id TEXT NOT NULL')
    expect(migration).toContain("state IN ('DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED'")
    expect(migration).toContain('CREATE INDEX content_collections_owner_updated_idx')
    expect(migration).toContain("'collection.created'")
    expect(migration).toContain("'collection.updated'")
    expect(migration).toContain("'collection.deleted'")
  })

  it('lists creator-owned collection with one bounded D1 read and cursor pagination', async () => {
    const queries: string[] = []
    const db = {
      prepare(query: string) {
        queries.push(query)
        expect(query).toContain('FROM content_collections')
        expect(query).toContain('WHERE owner_user_id = ?')
        expect(query).toContain('ORDER BY updated_at DESC, id DESC')
        expect(query).toContain('LIMIT ?')
        return {
          bind: () => ({
            all: async () => ({
              results: [{
                id: 'collection_1',
                owner_user_id: 'user_1',
                creator_id: 'user_1',
                ip_id: null,
                state: 'DRAFT',
                version: 1,
                title: 'Collection 1',
                description: 'desc',
                cover_ref: null,
                etag: 'W/"1"',
                created_at: '2026-10-07T00:00:00.000Z',
                updated_at: '2026-10-07T00:00:00.000Z',
              }],
            }),
          }),
        }
      },
    } as never

    const result = await listCreatorCollection(db, 'user_1', null, 10)
    expect(queries).toHaveLength(1)
    expect(result).toMatchObject({
      items: [{
        id: 'collection_1',
        ownerUserId: 'user_1',
        creatorId: 'user_1',
        state: 'DRAFT',
        title: 'Collection 1',
      }],
      hasMore: false,
      nextCursor: null,
    })
  })
})
