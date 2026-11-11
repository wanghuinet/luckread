import { describe, expect, it, vi } from 'vitest'
import {
  buildCommentListReadQuery,
  CommentListReadStoreError,
  createD1CommentListReadStore,
  type CommentListReadInput,
  type CommentListReadRow,
} from './comment-list-read-store.js'

const input = (overrides: Partial<CommentListReadInput> = {}): CommentListReadInput => ({
  contentId: 'content-1',
  viewerUserId: 'viewer-1',
  cursor: null,
  limit: 20,
  sort: 'relevant',
  ...overrides,
})

describe('comment list D1 read store', () => {
  it('keeps recursive thread visibility, viewer Block/Mute and mention projection in one bounded query', async () => {
    const values: unknown[][] = []
    const all = vi.fn(async () => ({ results: [] as CommentListReadRow[] }))
    const db = {
      prepare(sql: string) {
        expect(sql).toContain('WITH RECURSIVE viewer AS (SELECT ? AS user_id)')
        expect(sql).toContain('JOIN public_comments parent ON parent.id = child.parent_id')
        expect(sql).toContain("block.relation_type = 'block'")
        expect(sql).toContain("mute.relation_type = 'mute'")
        expect(sql).toContain('parent.depth < 3')
        expect(sql).toContain('json_group_array(json_object(')
        expect(sql).toContain('LIMIT ?')
        return {
          bind(...bound: unknown[]) {
            values.push(bound)
            return { all }
          },
        }
      },
    }

    const store = createD1CommentListReadStore(db)
    await expect(store.list(input())).resolves.toEqual([])
    expect(all).toHaveBeenCalledOnce()
    expect(values).toHaveLength(1)
    expect(values[0]).toEqual([
      'viewer-1',
      'content-1',
      'viewer-1', 'viewer-1', 'viewer-1',
      'viewer-1', 'viewer-1', 'viewer-1',
      'content-1',
      21,
    ])
  })

  it('uses the same cursor tuple and ordering for recent and liked pages', () => {
    const cursor = {
      createdAt: '2026-11-11T10:00:00.123456Z',
      id: 'comment-1',
      threadCreatedAt: '2026-11-11T09:59:00.123456Z',
      threadId: 'root-1',
      threadLikeCount: 7,
    }
    const recent = buildCommentListReadQuery(input({ sort: 'recent', cursor }), 'd1')
    expect(recent.sql).toContain('c.thread_created_at DESC, c.thread_id DESC, c.created_at ASC, c.id ASC')
    expect(recent.sql).toContain('c.thread_created_at < ?')
    expect(recent.values).toContain(cursor.threadCreatedAt)
    expect(recent.values).toContain(cursor.id)

    const liked = buildCommentListReadQuery(input({ sort: 'liked', cursor }), 'd1')
    expect(liked.sql).toContain('c.thread_like_count DESC, c.thread_created_at DESC')
    expect(liked.sql).toContain('c.thread_like_count < ?')
    expect(liked.values).toContain(cursor.threadLikeCount)
    expect(liked.values).toContain(cursor.threadCreatedAt)
  })

  it('keeps placeholder and binding counts equal across all sort modes and viewer scopes', () => {
    for (const sort of ['relevant', 'recent', 'liked'] as const) {
      for (const viewerUserId of [null, 'viewer-1']) {
        const query = buildCommentListReadQuery(input({
          sort,
          viewerUserId,
          cursor: {
            createdAt: '2026-11-11T10:00:00.123456Z',
            id: 'comment-1',
            ...(sort !== 'relevant' ? {
              threadCreatedAt: '2026-11-11T09:59:00.123456Z',
              threadId: 'root-1',
            } : {}),
            ...(sort === 'liked' ? { threadLikeCount: 7 } : {}),
          },
        }), 'd1')
        expect((query.sql.match(/\?/g) ?? []).length).toBe(query.values.length)
      }
    }
  })

  it('normalizes D1 query failures to a stable store error', async () => {
    const broken = {
      prepare() {
        return { bind() { return { async all() { throw new Error('private database detail') } } } }
      },
    }
    await expect(createD1CommentListReadStore(broken).list(input())).rejects.toBeInstanceOf(CommentListReadStoreError)
    await expect(createD1CommentListReadStore(broken).list(input())).rejects.toThrow('COMMENT_LIST_READ_STORE_UNAVAILABLE')
  })
})
