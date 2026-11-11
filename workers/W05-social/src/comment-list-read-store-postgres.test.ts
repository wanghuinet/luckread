import { describe, expect, it, vi } from 'vitest'
import {
  CommentListReadStoreError,
  type CommentListReadInput,
  type CommentListReadRow,
} from './comment-list-read-store.js'
import { createPostgresCommentListReadStore } from './comment-list-read-store-postgres.js'

const input = (overrides: Partial<CommentListReadInput> = {}): CommentListReadInput => ({
  contentId: 'content-1',
  viewerUserId: 'viewer-1',
  cursor: null,
  limit: 20,
  sort: 'relevant',
  ...overrides,
})

const row: CommentListReadRow = {
  id: 'comment-1',
  content_id: 'content-1',
  author_user_id: 'author-1',
  parent_id: null,
  body: 'PostgreSQL comment',
  state: 'PUBLISHED',
  depth: 0,
  created_at: '2026-11-11T10:00:00.123456Z',
  updated_at: '2026-11-11T10:00:00.123456Z',
  mentions_json: '[{"userId":"mentioned-1","handle":"alice"}]',
  liked_by_viewer: true,
  thread_created_at: '2026-11-11T10:00:00.123456Z',
  thread_id: 'comment-1',
  thread_like_count: '3',
}

describe('PostgreSQL comment list read store', () => {
  it('uses parameterized PostgreSQL syntax and preserves timestamp precision and mention projection', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [row as unknown as Row] }
      },
    }
    const store = createPostgresCommentListReadStore(db)
    await expect(store.list(input())).resolves.toEqual([row])

    expect(calls).toHaveLength(1)
    const { sql, values } = calls[0]!
    expect(sql).toContain('WITH RECURSIVE viewer AS (SELECT $1::text AS user_id)')
    expect(sql).toContain('json_agg(json_build_object(')
    expect(sql).toContain("), '[]'::json)::text AS mentions_json")
    expect(sql).toContain('to_char(c.created_at AT TIME ZONE')
    expect(sql).toContain('HH24:MI:SS.US')
    expect(sql).not.toContain('json_group_array')
    expect(sql).not.toContain('datetime(')
    expect(sql).not.toContain('?')
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]))
    expect(Math.max(...placeholders)).toBe(values.length)
    expect(new Set(placeholders)).toEqual(new Set(Array.from({ length: values.length }, (_, index) => index + 1)))
    expect(values).toEqual([
      'viewer-1',
      'content-1',
      'viewer-1', 'viewer-1', 'viewer-1',
      'viewer-1', 'viewer-1', 'viewer-1',
      'content-1',
      21,
    ])
  })

  it('binds recent and liked cursors as timestamptz while preserving sort tuple semantics', async () => {
    for (const sort of ['recent', 'liked'] as const) {
      const calls: Array<{ sql: string; values: unknown[] }> = []
      const db = {
        async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
          calls.push({ sql, values })
          return { rows: [] as Row[] }
        },
      }
      const cursor = {
        createdAt: '2026-11-11T10:00:00.123456Z',
        id: 'comment-1',
        threadCreatedAt: '2026-11-11T09:59:00.654321Z',
        threadId: 'root-1',
        ...(sort === 'liked' ? { threadLikeCount: 7 } : {}),
      }
      await createPostgresCommentListReadStore(db).list(input({ sort, cursor }))
      const query = calls[0]!
      expect(query.sql).toContain('::timestamptz')
      expect(query.sql).toContain('HH24:MI:SS.US')
      if (sort === 'recent') {
        expect(query.sql).toContain('c.thread_created_at DESC, c.thread_id DESC, c.created_at ASC')
      } else {
        expect(query.sql).toContain('c.thread_like_count DESC, c.thread_created_at DESC')
        expect(query.sql).toContain('c.thread_like_count < $')
        expect(query.values).toContain(7)
      }
      expect(query.values).toContain(cursor.threadCreatedAt)
      expect(query.values).toContain(cursor.createdAt)
      expect(query.values).toContain(cursor.id)
    }
  })

  it('sanitizes PostgreSQL query failures', async () => {
    const db = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('private driver details')
        return { rows: [] as Row[] }
      },
    }
    await expect(createPostgresCommentListReadStore(db).list(input()))
      .rejects.toBeInstanceOf(CommentListReadStoreError)
    await expect(createPostgresCommentListReadStore(db).list(input()))
      .rejects.toThrow('COMMENT_LIST_READ_STORE_UNAVAILABLE')
  })
})
