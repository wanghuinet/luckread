import { describe, expect, it } from 'vitest'

import { ContentRuntimeError } from './content-runtime.js'
import {
  createPostgresContentContextReadStore,
  type ContentContextPostgresQueryExecutor,
} from './content-context-read-store-postgres.js'

function fixture(rows: Record<string, unknown>[] = [], fail = false) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const database: ContentContextPostgresQueryExecutor = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (fail) throw new Error('simulated query failure')
      return { rows: rows as Row[] }
    },
  }
  return { database, calls }
}

describe('W03 PostgreSQL content context read store', () => {
  it('resolves a published author context by ID or stable slug', async () => {
    const { database, calls } = fixture([{ id: 'post_1', owner_user_id: 'user_1' }])
    const store = createPostgresContentContextReadStore(database)

    await expect(store.getPublishedContentAuthorContext('story-slug'))
      .resolves.toEqual({ contentId: 'post_1', ownerUserId: 'user_1' })
    expect(calls[0]?.sql).toContain('(id = $1 OR slug = $1)')
    expect(calls[0]?.values).toEqual(['story-slug'])
    expect(calls[0]?.sql).toContain("state = 'PUBLISHED'")
  })

  it('preserves published social context state and normalizes PostgreSQL timestamps', async () => {
    const updatedAt = new Date('2026-11-15T12:34:56.789Z')
    const { database, calls } = fixture([{
      id: 'post_1',
      owner_user_id: null,
      content_type: 'post',
      updated_at: updatedAt,
    }])
    const store = createPostgresContentContextReadStore(database)

    await expect(store.getPublishedContentSocialContext('post_1')).resolves.toEqual({
      contentId: 'post_1',
      ownerUserId: null,
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-11-15T12:34:56.789Z',
    })
    expect(calls[0]?.values).toEqual(['post_1'])
  })

  it('uses a bounded PostgreSQL text-array query and restores unique caller order for batch social contexts', async () => {
    const { database, calls } = fixture([
      { id: 'post_2', owner_user_id: 'user_2', content_type: 'post', title: 'two', updated_at: '2026-11-15T12:00:00.000Z' },
      { id: 'post_1', owner_user_id: 'user_1', content_type: 'article', title: 'one', updated_at: '2026-11-14T12:00:00.000Z' },
    ])
    const store = createPostgresContentContextReadStore(database)

    await expect(store.getPublishedContentSocialContexts(['post_1', 'post_2', 'post_1', 'missing'])).resolves.toEqual([
      { contentId: 'post_1', ownerUserId: 'user_1', contentType: 'article', state: 'PUBLISHED', title: 'one', updatedAt: '2026-11-14T12:00:00.000Z' },
      { contentId: 'post_2', ownerUserId: 'user_2', contentType: 'post', state: 'PUBLISHED', title: 'two', updatedAt: '2026-11-15T12:00:00.000Z' },
    ])
    expect(calls[0]?.sql).toContain('id = ANY($1::text[])')
    expect(calls[0]?.values).toEqual([['post_1', 'post_2', 'missing']])
    expect(calls[0]?.sql).toContain("state = 'PUBLISHED'")
  })

  it('enforces owner and post lifecycle predicates for owned and public-post contexts', async () => {
    const owned = fixture([{
      id: 'post_1', owner_user_id: 'user_1', content_type: 'post',
      state: 'DRAFT', updated_at: '2026-11-15T12:00:00.000Z',
    }])
    await expect(createPostgresContentContextReadStore(owned.database).getOwnedPostContext('post_1', 'user_1'))
      .resolves.toMatchObject({ contentId: 'post_1', ownerUserId: 'user_1', contentType: 'post', state: 'DRAFT' })
    expect(owned.calls[0]?.values).toEqual(['post_1', 'user_1'])
    expect(owned.calls[0]?.sql).toContain("state IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')")

    const publicPost = fixture([{
      id: 'post_1', owner_user_id: 'user_1', content_type: 'post',
      updated_at: '2026-11-15T12:00:00.000Z',
    }])
    await expect(createPostgresContentContextReadStore(publicPost.database).getPublishedOwnerPostContext('post_1', 'user_1'))
      .resolves.toMatchObject({ contentId: 'post_1', ownerUserId: 'user_1', contentType: 'post', state: 'PUBLISHED' })
    expect(publicPost.calls[0]?.values).toEqual(['post_1', 'user_1'])
    expect(publicPost.calls[0]?.sql).toContain("state = 'PUBLISHED'")
  })

  it('does not query for empty batches and maps missing and database errors safely', async () => {
    const empty = fixture()
    await expect(createPostgresContentContextReadStore(empty.database).getPublishedContentSocialContexts([]))
      .resolves.toEqual([])
    expect(empty.calls).toHaveLength(0)

    const missing = fixture()
    await expect(createPostgresContentContextReadStore(missing.database).getPublishedContentSocialContext('missing'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const failed = fixture([], true)
    await expect(createPostgresContentContextReadStore(failed.database).getPublishedContentSocialContext('post_1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    await expect(createPostgresContentContextReadStore(empty.database).getPublishedContentSocialContext('bad/id'))
      .rejects.toBeInstanceOf(ContentRuntimeError)
  })
})
