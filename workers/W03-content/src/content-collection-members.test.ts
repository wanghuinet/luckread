import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { listCollectionMembers } from './content-collection-members.js'

const member = {
  relationshipId: 'rel_1',
  collectionId: 'collection_1',
  contentId: 'content_1',
  contentSlug: 'episode-1',
  contentType: 'article' as const,
  contentState: 'PUBLISHED',
  title: 'Episode 1',
  position: 1,
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
}

describe('W03 collection membership / Neon ordering', () => {
  it('preserves historical membership schema and unique position authority', () => {
    const migration = readFileSync(resolve(process.cwd(), 'workers/W03-content/migrations/0010_content_collection_membership_ordering.sql'), 'utf8')
    expect(migration).toContain('CREATE TABLE content_relationships')
    expect(migration).toContain('position INTEGER')
    expect(migration).toContain('content_relationships_collection_position_unique_idx')
  })

  it('uses the Neon membership reader with a bounded deterministic page', async () => {
    const calls: unknown[][] = []
    const readStore = {
      async listCollectionMembers(ownerUserId: string, parentId: string, cursor: { position: number; id: string } | null, limit: number) {
        calls.push([ownerUserId, parentId, cursor, limit])
        return {
          items: [member, { ...member, relationshipId: 'rel_2', position: 2 }],
          collectionVersion: 9,
          collectionEtag: 'W/"9"',
        }
      },
    }
    const result = await listCollectionMembers(readStore, 'user_1', 'collection_1', null, 1)
    expect(calls).toEqual([['user_1', 'collection_1', null, 2]])
    expect(result.items).toEqual([member])
    expect(result.hasMore).toBe(true)
    expect(result.collectionVersion).toBe(9)
    expect(result.collectionEtag).toBe('W/"9"')
    expect(result.nextCursor).toEqual(expect.any(String))
  })

  it('rejects cursors scoped to a different user or parent before calling Neon', async () => {
    const calls: unknown[][] = []
    const readStore = {
      async listCollectionMembers(ownerUserId: string, parentId: string, cursor: { position: number; id: string } | null, limit: number) {
        calls.push([ownerUserId, parentId, cursor, limit])
        return { items: [member, { ...member, relationshipId: 'rel_2', position: 2 }], collectionVersion: 9, collectionEtag: 'W/"9"' }
      },
    }
    const first = await listCollectionMembers(readStore, 'user_1', 'collection_1', null, 1)
    await expect(listCollectionMembers(readStore, 'user_2', 'collection_1', first.nextCursor, 1))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listCollectionMembers(readStore, 'user_1', 'collection_2', first.nextCursor, 1))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(calls).toHaveLength(1)
  })

  it('keeps mutation paths bound to their Neon persistence ports', () => {
    const runtime = readFileSync(resolve(process.cwd(), 'workers/W03-content/src/content-collection-members.ts'), 'utf8')
    expect(runtime).toContain('export async function attachCollectionMember')
    expect(runtime).toContain('export async function removeCollectionMember')
    expect(runtime).toContain('export async function reorderCollectionMember')
    expect(runtime).toContain('mutationStore.loadMutation')
    expect(runtime).not.toContain('ContentD1')
    expect(runtime).not.toContain('.prepare(')
    expect(runtime).not.toContain('.batch(')
  })

  it('keeps PostgreSQL member order based on position and relationship identity', () => {
    const adapter = readFileSync(resolve(process.cwd(), 'workers/W03-content/src/content-members-read-store-postgres.ts'), 'utf8')
    expect(adapter).toContain('ORDER BY r.position ASC, r.relationship_id ASC')
  })
})
