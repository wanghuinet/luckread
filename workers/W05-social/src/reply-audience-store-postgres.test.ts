import { describe, expect, it } from 'vitest'
import { ReplyAudienceStoreError } from './reply-audience-store.js'
import {
  createPostgresReplyAudienceStore,
  type ReplyAudiencePostgresQueryExecutor,
} from './reply-audience-store-postgres.js'

const row = {
  content_id: 'content-1',
  owner_user_id: 'owner-1',
  audience: 'mentioned' as const,
  mentioned_user_ids_json: '["user-2"]',
  updated_at: '2026-11-10T00:00:00.000Z',
}

describe('W05 PostgreSQL reply-audience store', () => {
  it('uses parameterized owner-scoped upsert and returns the persisted policy', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: ReplyAudiencePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [row as unknown as Row] }
      },
    }

    await expect(createPostgresReplyAudienceStore(db).set({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      audience: 'mentioned',
      mentionedUserIdsJson: '["user-2"]',
      now: row.updated_at,
    })).resolves.toEqual({
      contentId: row.content_id,
      ownerUserId: row.owner_user_id,
      audience: row.audience,
      mentionedUserIdsJson: row.mentioned_user_ids_json,
      updatedAt: row.updated_at,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual([
      'content-1', 'owner-1', 'mentioned', '["user-2"]', row.updated_at, row.updated_at,
    ])
    expect(calls[0]?.sql).toContain('ON CONFLICT(content_id) DO UPDATE')
    expect(calls[0]?.sql).toContain('WHERE social_content_reply_policies.owner_user_id = EXCLUDED.owner_user_id')
  })

  it('scopes reads by both content and owner', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: ReplyAudiencePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [row as unknown as Row] }
      },
    }

    await expect(createPostgresReplyAudienceStore(db).get('content-1', 'owner-1')).resolves.toMatchObject({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      audience: 'mentioned',
    })
    expect(calls[0]?.values).toEqual(['content-1', 'owner-1'])
    expect(calls[0]?.sql).toContain('WHERE content_id = $1 AND owner_user_id = $2')
  })

  it('returns null when an upsert loses the owner predicate', async () => {
    const db: ReplyAudiencePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() { return { rows: [] as Row[] } },
    }
    await expect(createPostgresReplyAudienceStore(db).set({
      contentId: 'content-1',
      ownerUserId: 'other-owner',
      audience: 'everyone',
      mentionedUserIdsJson: '[]',
      now: row.updated_at,
    })).resolves.toBeNull()
  })

  it('sanitizes provider errors', async () => {
    const db: ReplyAudiencePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('private-neon-host-and-auth-detail')
      },
    }
    await expect(createPostgresReplyAudienceStore(db).get('content-1', 'owner-1'))
      .rejects.toBeInstanceOf(ReplyAudienceStoreError)
  })
})
