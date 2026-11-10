import { describe, expect, it, vi } from 'vitest'
import { createPostgresCommentCreateStore } from './comment-create-store-postgres.js'
import type { CommentCreatePostgresQueryExecutor } from './comment-create-store-postgres.js'
import {
  replyAudienceAllowedPostgresParams,
  replyAudienceAllowedPostgresSql,
} from './reply-audience-postgres-predicate.js'

const validationInput = {
  actorUserId: 'actor-1',
  contentId: 'content-1',
  parentId: 'parent-1',
  idempotencyKey: 'idem-1',
  actorVerified: true,
}
const insertInput = {
  ...validationInput,
  id: 'comment-1',
  body: 'hello',
  depth: 1,
  now: '2026-11-10T12:00:00.000Z',
}

describe('W05 PostgreSQL comment-create store', () => {
  it('validates idempotency, content, parent, rate limit, block and reply audience with parameterized PostgreSQL SQL', async () => {
    const row = { content_state: 'PUBLISHED', blocked: false, reply_audience_allowed: true, recent_count: 0 }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresCommentCreateStore({ query } as unknown as CommentCreatePostgresQueryExecutor)

    await expect(store.validate(validationInput)).resolves.toEqual(row)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('idempotency_key = $10')
    expect(String(sql)).toContain("NOW() - INTERVAL '60 seconds'")
    expect(String(sql)).toContain("relation_type = 'block'")
    expect(String(sql)).toContain(replyAudienceAllowedPostgresSql)
    expect(values).toEqual([
      ...replyAudienceAllowedPostgresParams('actor-1', true),
      'idem-1',
      'content-1',
      'parent-1',
    ])
  })

  it('performs the final atomic insert with parent, block and reply-audience predicates rechecked', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: 'comment-1' }] }))
    const store = createPostgresCommentCreateStore({ query } as unknown as CommentCreatePostgresQueryExecutor)

    await store.insert(insertInput)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain("content.state = 'PUBLISHED'")
    expect(String(sql)).toContain('parent.depth < 3')
    expect(String(sql)).toContain('ON CONFLICT (author_user_id, idempotency_key)')
    expect(String(sql)).toContain(replyAudienceAllowedPostgresSql)
    expect(values).toHaveLength(27)
    expect(values.slice(0, 9)).toEqual(replyAudienceAllowedPostgresParams('actor-1', true))
    expect(values.slice(9)).toEqual([
      'comment-1', 'content-1', 'actor-1', 'parent-1', 'hello', 1, 'idem-1',
      '2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z',
      'content-1', 'parent-1', 'parent-1', 'actor-1', 'actor-1', 'actor-1',
      'parent-1', 'parent-1', 'actor-1',
    ])
  })

  it('rechecks the audience after a final insert loses a race', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ content_state: 'PUBLISHED', reply_audience_allowed: false }] }))
    const store = createPostgresCommentCreateStore({ query } as unknown as CommentCreatePostgresQueryExecutor)

    await expect(store.getFinalState({
      actorUserId: 'actor-1',
      contentId: 'content-1',
      actorVerified: false,
    })).resolves.toEqual({ content_state: 'PUBLISHED', reply_audience_allowed: false })
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain(replyAudienceAllowedPostgresSql)
    expect(values).toEqual([...replyAudienceAllowedPostgresParams('actor-1', false), 'content-1'])
  })

  it('sanitizes PostgreSQL provider failures', async () => {
    const store = createPostgresCommentCreateStore({
      query: vi.fn(async () => { throw new Error('secret host, password and query') }),
    } as unknown as CommentCreatePostgresQueryExecutor)

    await expect(store.validate(validationInput)).rejects.toMatchObject({ message: 'COMMENT_CREATE_STORE_UNAVAILABLE' })
    await expect(store.insert(insertInput)).rejects.toMatchObject({ message: 'COMMENT_CREATE_STORE_UNAVAILABLE' })
    await expect(store.getFinalState({
      actorUserId: 'actor-1',
      contentId: 'content-1',
      actorVerified: false,
    })).rejects.toMatchObject({ message: 'COMMENT_CREATE_STORE_UNAVAILABLE' })
  })
})
