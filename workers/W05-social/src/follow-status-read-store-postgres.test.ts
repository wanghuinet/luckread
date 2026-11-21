import { describe, expect, it } from 'vitest'

import { FollowStoreError } from './follow-store.js'
import { createPostgresFollowStatusReadStore } from './follow-status-read-store-postgres.js'
import type { FollowStatusReadRow } from './follow-status-read-store.js'

function fakePostgres(options: {
  rows?: FollowStatusReadRow[]
  fail?: boolean
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    async query<Row>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('secret-driver-detail')
      return { rows: (options.rows ?? []) as Row[] }
    },
  }
  return { db, calls }
}

describe('W05 PostgreSQL Follow status read store', () => {
  it('reads an actor-scoped follow status with both Block directions', async () => {
    const row: FollowStatusReadRow = {
      relationship_id: 'r-follow',
      created_at: '2026-11-10T01:02:03.004Z',
      blocked: false,
    }
    const { db, calls } = fakePostgres({ rows: [row] })
    const result = await createPostgresFollowStatusReadStore(db)
      .getStatus({ followerUserId: 'user-follower', targetUserId: 'user-target' })

    expect(result).toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('FROM social_follow_relationships rel')
    expect(calls[0]?.sql).toContain('rel.follower_user_id = $1 AND rel.target_user_id = $2')
    expect(calls[0]?.sql).toContain("block.relation_type = 'block'")
    expect(calls[0]?.sql).toContain('block.actor_user_id = $1 AND block.target_user_id = $2')
    expect(calls[0]?.sql).toContain('block.actor_user_id = $2 AND block.target_user_id = $1')
    expect(calls[0]?.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    expect(calls[0]?.sql).toContain('LIMIT 1')
    expect(calls[0]?.values).toEqual(['user-follower', 'user-target'])
  })

  it('returns null when the actor has no active follow relationship', async () => {
    const { db } = fakePostgres()
    await expect(createPostgresFollowStatusReadStore(db)
      .getStatus({ followerUserId: 'user-follower', targetUserId: 'user-target' }))
      .resolves.toBeNull()
  })

  it('maps provider failures to a sanitized service-unavailable error', async () => {
    const { db } = fakePostgres({ fail: true })
    await expect(createPostgresFollowStatusReadStore(db)
      .getStatus({ followerUserId: 'user-follower', targetUserId: 'user-target' }))
      .rejects.toBeInstanceOf(FollowStoreError)
  })
})
