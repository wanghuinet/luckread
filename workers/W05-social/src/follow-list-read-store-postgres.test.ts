import { describe, expect, it } from 'vitest'

import { FollowStoreError } from './follow-store.js'
import { createPostgresFollowListReadStore } from './follow-list-read-store-postgres.js'
import type { FollowListReadRow } from './follow-list-read-store.js'

const owner = 'user_owner'

function fakePostgres(options: {
  rows?: FollowListReadRow[]
  count?: number
  fail?: boolean
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    async query<Row>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('secret-driver-detail')
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total_count: options.count ?? 0 }] as Row[] }
      }
      return { rows: (options.rows ?? []) as Row[] }
    },
  }
  return { db, calls }
}

describe('W05 PostgreSQL Follow list read store', () => {
  it('reads followers with two-sided block filtering, deterministic order and limit plus one', async () => {
    const rows: FollowListReadRow[] = [{
      relationship_id: 'r2',
      user_id: 'user_follower',
      followed_at: '2026-11-10T01:02:03.004Z',
    }]
    const { db, calls } = fakePostgres({ rows })
    const result = await createPostgresFollowListReadStore(db)
      .list({ userId: owner, direction: 'followers', cursor: null, limit: 20 })

    expect(result).toEqual(rows)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('rel.target_user_id = $1')
    expect(calls[0]?.sql).toContain('rel.follower_user_id AS user_id')
    expect(calls[0]?.sql).toContain("block.relation_type = 'block'")
    expect(calls[0]?.sql).toContain('block.actor_user_id = $1 AND block.target_user_id = rel.follower_user_id')
    expect(calls[0]?.sql).toContain('block.actor_user_id = rel.follower_user_id AND block.target_user_id = $1')
    expect(calls[0]?.sql).toContain('ORDER BY rel.created_at DESC, rel.relationship_id DESC')
    expect(calls[0]?.sql).toContain('LIMIT $2')
    expect(calls[0]?.values).toEqual([owner, 21])
  })

  it('reads following with a timestamp and relationship cursor using PostgreSQL placeholders', async () => {
    const cursor = {
      createdAt: '2026-11-09T23:59:59.999Z',
      relationshipId: 'r_cursor',
    }
    const { db, calls } = fakePostgres()
    await createPostgresFollowListReadStore(db)
      .list({ userId: owner, direction: 'following', cursor, limit: 10 })

    expect(calls[0]?.sql).toContain('rel.follower_user_id = $1')
    expect(calls[0]?.sql).toContain('rel.target_user_id AS user_id')
    expect(calls[0]?.sql).toContain('rel.created_at < $2::timestamptz')
    expect(calls[0]?.sql).toContain('rel.created_at = $2::timestamptz AND rel.relationship_id < $3')
    expect(calls[0]?.sql).toContain('LIMIT $4')
    expect(calls[0]?.values).toEqual([owner, cursor.createdAt, cursor.relationshipId, 11])
  })

  it('counts only unblocked followers and preserves the separate aggregate query', async () => {
    const { db, calls } = fakePostgres({ count: 17 })
    const result = await createPostgresFollowListReadStore(db)
      .count({ userId: owner, direction: 'followers' })

    expect(result).toBe(17)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('FROM social_follow_relationships rel_count')
    expect(calls[0]?.sql).toContain('rel_count.target_user_id = $1')
    expect(calls[0]?.sql).toContain('rel_count.follower_user_id')
    expect(calls[0]?.values).toEqual([owner])
  })

  it('counts only unblocked following relations', async () => {
    const { db, calls } = fakePostgres({ count: 8 })
    const result = await createPostgresFollowListReadStore(db)
      .count({ userId: owner, direction: 'following' })

    expect(result).toBe(8)
    expect(calls[0]?.sql).toContain('rel_count.follower_user_id = $1')
    expect(calls[0]?.sql).toContain('rel_count.target_user_id')
  })

  it('maps driver failures to a sanitized service-unavailable error', async () => {
    const { db } = fakePostgres({ fail: true })
    const store = createPostgresFollowListReadStore(db)
    await expect(store.list({
      userId: owner,
      direction: 'followers',
      cursor: null,
      limit: 20,
    })).rejects.toBeInstanceOf(FollowStoreError)
    await expect(store.count({ userId: owner, direction: 'following' }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
