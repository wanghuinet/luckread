import { describe, expect, it, vi } from 'vitest'
import { FollowStoreError, type FollowRow } from './follow-store.js'
import {
  createPostgresFollowStore,
  type FollowPostgresQueryExecutor,
} from './follow-store-postgres.js'

describe('W05 PostgreSQL follow store', () => {
  it('creates a follow with a parameterized bidirectional Block guard', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const row: FollowRow = {
      relationship_id: 'follow-pg-1',
      follower_user_id: 'viewer-1',
      target_user_id: 'creator-1',
      created_at: '2026-11-12T08:00:00.123Z',
    }
    const db: FollowPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [row] as unknown as Row[] }
      },
    }

    await expect(createPostgresFollowStore(db).follow({
      relationshipId: 'new-follow-id',
      followerUserId: 'viewer-1',
      targetUserId: 'creator-1',
      createdAt: '2026-11-12T08:00:00.000Z',
    })).resolves.toEqual(row)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual([
      'new-follow-id',
      'viewer-1',
      'creator-1',
      '2026-11-12T08:00:00.000Z',
    ])
    const sql = calls[0]?.sql ?? ''
    expect(sql).toContain('INSERT INTO social_follow_relationships')
    expect(sql).toContain('SELECT $1, $2, $3, $4')
    expect(sql).toContain("block.relation_type = 'block'")
    expect(sql).toContain('(block.actor_user_id = $2 AND block.target_user_id = $3)')
    expect(sql).toContain('(block.actor_user_id = $3 AND block.target_user_id = $2)')
    expect(sql).toContain('ON CONFLICT (follower_user_id, target_user_id)')
    expect(sql).toContain('DO UPDATE SET relationship_id = social_follow_relationships.relationship_id')
    expect(sql).not.toContain('created_at = EXCLUDED.created_at')
    expect(sql).toContain('RETURNING')
    expect(sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  })

  it('returns null when the Block guard suppresses the insert', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const db = { query } as unknown as FollowPostgresQueryExecutor

    await expect(createPostgresFollowStore(db).follow({
      relationshipId: 'new-follow-id',
      followerUserId: 'viewer-1',
      targetUserId: 'blocked-creator',
      createdAt: '2026-11-12T08:00:00.000Z',
    })).resolves.toBeNull()

    expect(query).toHaveBeenCalledTimes(1)
    const [, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(values).toEqual([
      'new-follow-id',
      'viewer-1',
      'blocked-creator',
      '2026-11-12T08:00:00.000Z',
    ])
  })

  it('maps follow provider failures to a sanitized 503', async () => {
    const db: FollowPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('secret-postgres-host-and-driver-detail')
      },
    }

    await expect(createPostgresFollowStore(db).follow({
      relationshipId: 'new-follow-id',
      followerUserId: 'viewer-1',
      targetUserId: 'creator-1',
      createdAt: '2026-11-12T08:00:00.000Z',
    })).rejects.toBeInstanceOf(FollowStoreError)

    await expect(createPostgresFollowStore(db).follow({
      relationshipId: 'new-follow-id',
      followerUserId: 'viewer-1',
      targetUserId: 'creator-1',
      createdAt: '2026-11-12T08:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'FOLLOW_STORE_UNAVAILABLE',
    })
  })

  it('performs an idempotent actor/target-scoped unfollow delete', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const db = { query } as unknown as FollowPostgresQueryExecutor

    await expect(
      createPostgresFollowStore(db).unfollow('viewer-1', 'creator-1'),
    ).resolves.toBeUndefined()

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(values).toEqual(['viewer-1', 'creator-1'])
    expect(sql).toContain('DELETE FROM social_follow_relationships')
    expect(sql).toContain('follower_user_id = $1')
    expect(sql).toContain('target_user_id = $2')
  })

  it('maps unfollow provider failures to a sanitized 503', async () => {
    const db: FollowPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('secret-postgres-host-and-driver-detail')
      },
    }

    await expect(
      createPostgresFollowStore(db).unfollow('viewer-1', 'creator-1'),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'FOLLOW_STORE_UNAVAILABLE',
    })
  })
})
