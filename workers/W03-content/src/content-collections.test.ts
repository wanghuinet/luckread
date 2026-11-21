import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getCollection, listCreatorCollections } from './content-collections.js'

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

  it('binds creator collection cursors to the owning user', async () => {
    const row = {
      id: 'collection_1',
      owner_user_id: 'user_1',
      creator_id: 'user_1',
      state: 'DRAFT',
      version: 1,
      title: 'Collection 1',
      description: 'desc',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-07T00:00:00.000Z',
      updated_at: '2026-10-07T00:00:00.000Z',
    }
    let prepareCalls = 0
    const db = {
      prepare() {
        prepareCalls += 1
        return { bind: () => ({ all: async () => ({ results: [row, { ...row, id: 'collection_2' }] }) }) }
      },
    } as never
    const first = await listCreatorCollections(db, 'user_1', null, 1)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    await expect(listCreatorCollections(db, 'user_2', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect(prepareCalls).toBe(1)
  })

  it('lists creator-owned collections with one bounded D1 read and cursor pagination', async () => {
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

    const result = await listCreatorCollections(db, 'user_1', null, 10)
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

  it('uses the injected Neon reader for owner-scoped collection detail reads', async () => {
    const collection = {
      id: 'collection_1',
      ownerUserId: 'user_1',
      creatorId: 'user_1',
      state: 'DRAFT' as const,
      version: 3,
      title: 'Collection 1',
      description: 'description',
      coverRef: null,
      etag: 'W/"3"',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    }
    const calls: unknown[][] = []
    const readStore = {
      async getCollection(ownerUserId: string, collectionId: string) {
        calls.push([ownerUserId, collectionId])
        return ownerUserId === 'user_1' && collectionId === 'collection_1' ? collection : null
      },
      async listCreatorCollections() { return [] },
    }
    const db = { prepare() { throw new Error('Neon reader must be used instead of D1') } } as never

    await expect(getCollection(db, 'user_1', 'collection_1', readStore)).resolves.toEqual(collection)
    await expect(getCollection(db, 'user_2', 'collection_1', readStore))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(calls).toEqual([['user_1', 'collection_1'], ['user_2', 'collection_1']])
  })

  it('uses the injected Neon reader for the bounded creator collection list', async () => {
    const calls: unknown[][] = []
    const collection = {
      id: 'collection_1',
      ownerUserId: 'user_1',
      creatorId: 'user_1',
      state: 'DRAFT' as const,
      version: 1,
      title: 'Collection 1',
      description: 'desc',
      coverRef: null,
      etag: 'W/"1"',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
    }
    const readStore = {
      async listCreatorCollections(ownerUserId: string, cursor: { updatedAt: string; id: string } | null, limit: number) {
        calls.push([ownerUserId, cursor, limit])
        return [collection, { ...collection, id: 'collection_2' }]
      },
    }
    const db = {
      prepare() {
        throw new Error('Neon reader must be used instead of D1')
      },
    } as never

    const result = await listCreatorCollections(db, 'user_1', null, 1, readStore)

    expect(calls).toEqual([['user_1', null, 2]])
    expect(result.items).toEqual([collection])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual(expect.any(String))
  })
})
