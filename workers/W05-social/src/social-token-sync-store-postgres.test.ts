import { describe, expect, it, vi } from 'vitest'
import { createPostgresSocialTokenSyncStore } from './social-token-sync-store-postgres.js'
import type { SocialTokenSyncPostgresQueryExecutor } from './social-token-sync-store-postgres.js'

describe('W05 PostgreSQL social-token sync store', () => {
  it('loads comment ownership and publication state from the W05-owned comment row', async () => {
    const row = { content_id: 'content-1', author_user_id: 'author-1', state: 'PUBLISHED' }
    const query = vi.fn(async () => ({ rows: [row] }))
    const store = createPostgresSocialTokenSyncStore({ query } as unknown as SocialTokenSyncPostgresQueryExecutor)

    await expect(store.getCommentContext('comment-1')).resolves.toEqual(row)
    expect(query.mock.calls[0]?.[0]).toContain('FROM social_comments')
    expect(query.mock.calls[0]?.[1]).toEqual(['comment-1'])
  })

  it('reads immutable historical mention identities without joining user profiles', async () => {
    const rows = [{ mention_id: 'mention-1', mentioned_user_id: 'stable-user', handle: 'alice' }]
    const query = vi.fn(async () => ({ rows }))
    const store = createPostgresSocialTokenSyncStore({ query } as unknown as SocialTokenSyncPostgresQueryExecutor)

    await expect(store.listMentions('comment', 'comment-1')).resolves.toEqual(rows)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('FROM social_mentions')
    expect(String(sql)).not.toMatch(/JOIN\s+(?:users|profiles)/i)
    expect(values).toEqual(['comment', 'comment-1'])
  })

  it('atomically replaces topic edges and only removes mention identities that are no longer present', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const store = createPostgresSocialTokenSyncStore({ query } as unknown as SocialTokenSyncPostgresQueryExecutor)

    await store.replaceTargetRelations({
      targetType: 'comment',
      targetId: 'comment-1',
      retainedMentionIds: ['mention-keep'],
    })
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('WITH deleted_topics AS')
    expect(String(sql)).toContain('DELETE FROM social_mentions')
    expect(String(sql)).toContain('mention_id <> ALL($3::text[])')
    expect(values).toEqual(['comment', 'comment-1', ['mention-keep']])
  })

  it('upserts a topic and attaches the target edge in one statement', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const store = createPostgresSocialTokenSyncStore({ query } as unknown as SocialTokenSyncPostgresQueryExecutor)

    await store.upsertTopicAndAttach({
      topicId: 'topic_reading',
      normalizedName: 'reading',
      displayName: 'reading',
      targetType: 'comment',
      targetId: 'comment-1',
      token: '#Reading',
      relationId: 'relation-1',
      now: '2026-11-14T00:00:00.000Z',
    })
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('ON CONFLICT (normalized_name)')
    expect(String(sql)).toContain('INSERT INTO social_target_topics')
    expect(String(sql)).toContain('ON CONFLICT DO NOTHING')
    expect(values).toEqual([
      'topic_reading', 'reading', 'reading', '2026-11-14T00:00:00.000Z',
      'relation-1', 'comment', 'comment-1', '#Reading',
    ])
  })

  it('inserts mention identity idempotently', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const store = createPostgresSocialTokenSyncStore({ query } as unknown as SocialTokenSyncPostgresQueryExecutor)

    await store.insertMention({
      mentionId: 'mention-1',
      targetType: 'comment',
      targetId: 'comment-1',
      actorUserId: 'author-1',
      mentionedUserId: 'mentioned-1',
      handle: 'alice',
      now: '2026-11-14T00:00:00.000Z',
    })
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('ON CONFLICT DO NOTHING')
    expect(values).toEqual([
      'mention-1', 'comment', 'comment-1', 'author-1', 'mentioned-1', 'alice',
      '2026-11-14T00:00:00.000Z',
    ])
  })

  it('sanitizes PostgreSQL provider errors', async () => {
    const store = createPostgresSocialTokenSyncStore({
      query: vi.fn(async () => { throw new Error('secret host password sql') }),
    } as unknown as SocialTokenSyncPostgresQueryExecutor)

    await expect(store.getCommentContext('comment-1')).rejects.toMatchObject({ message: 'SOCIAL_TOKEN_SYNC_STORE_UNAVAILABLE' })
    await expect(store.listMentions('comment', 'comment-1')).rejects.toMatchObject({ message: 'SOCIAL_TOKEN_SYNC_STORE_UNAVAILABLE' })
    await expect(store.replaceTargetRelations({ targetType: 'comment', targetId: 'comment-1', retainedMentionIds: [] }))
      .rejects.toMatchObject({ message: 'SOCIAL_TOKEN_SYNC_STORE_UNAVAILABLE' })
  })
})
