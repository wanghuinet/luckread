import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getCollection, listCreatorCollections } from './content-collections.js'

const makeCollection = (id = 'collection_1') => ({
  id,
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
})

describe('W03 collection foundation', () => {
  it('preserves historical collection schema and lifecycle event provenance', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0009_content_collections.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_collections')
    expect(migration).toContain('creator_id TEXT NOT NULL')
    expect(migration).toContain('CREATE INDEX content_collections_owner_updated_idx')
    expect(migration).toContain("'collection.created'")
    expect(migration).toContain("'collection.updated'")
    expect(migration).toContain("'collection.deleted'")
  })

  it('binds creator-collection cursors to the owning user before querying Neon', async () => {
    const calls: unknown[][] = []
    const store = {
      async getCollection() { return null },
      async listCreatorCollections(ownerUserId: string, cursor: { updatedAt: string; id: string } | null, limit: number) {
        calls.push([ownerUserId, cursor, limit])
        return [makeCollection(), makeCollection('collection_2')]
      },
    }
    const first = await listCreatorCollections(store, 'user_1', null, 1)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    await expect(listCreatorCollections(store, 'user_2', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect(calls).toEqual([['user_1', null, 2]])
  })

  it('uses Neon for owner-scoped collection detail reads and hides missing rows', async () => {
    const collection = makeCollection()
    const calls: unknown[][] = []
    const store = {
      async getCollection(ownerUserId: string, collectionId: string) {
        calls.push([ownerUserId, collectionId])
        return ownerUserId === 'user_1' && collectionId === 'collection_1' ? collection : null
      },
      async listCreatorCollections() { return [] },
    }
    await expect(getCollection(store, 'user_1', 'collection_1')).resolves.toEqual(collection)
    await expect(getCollection(store, 'user_2', 'collection_1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(calls).toEqual([['user_1', 'collection_1'], ['user_2', 'collection_1']])
  })

  it('uses a bounded Neon read for creator pagination', async () => {
    const calls: unknown[][] = []
    const collection = makeCollection()
    const store = {
      async getCollection() { return null },
      async listCreatorCollections(ownerUserId: string, cursor: { updatedAt: string; id: string } | null, limit: number) {
        calls.push([ownerUserId, cursor, limit])
        return [collection, makeCollection('collection_2')]
      },
    }
    const result = await listCreatorCollections(store, 'user_1', null, 1)
    expect(calls).toEqual([['user_1', null, 2]])
    expect(result.items).toEqual([collection])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual(expect.any(String))
  })
})
