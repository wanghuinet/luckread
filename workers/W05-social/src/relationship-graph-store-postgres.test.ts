import { describe, expect, it } from 'vitest'

import { RelationshipGraphStoreError } from './relationship-graph-store.js'
import { createPostgresRelationshipGraphReadStore } from './relationship-graph-store-postgres.js'
import type { RelationshipGraphReadRow } from './relationship-graph-store.js'

function fakePostgres(options: {
  row?: RelationshipGraphReadRow | null
  fail?: boolean
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    async query<Row>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('secret-driver-detail')
      return { rows: options.row ? [options.row as Row] : [] }
    },
  }
  return { db, calls }
}

describe('W05 PostgreSQL RelationshipGraph read store', () => {
  it('reads all six directional relationship states using one bounded query', async () => {
    const row: RelationshipGraphReadRow = {
      following: true,
      followed_by: true,
      relationship_id: 'relationship-1',
      created_at: '2026-11-10T01:02:03.004Z',
      blocked: false,
      blocked_by: false,
      muted: true,
    }
    const { db, calls } = fakePostgres({ row })
    const result = await createPostgresRelationshipGraphReadStore(db).read('viewer-1', 'target-1')

    expect(result).toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('follower_user_id = $1 AND target_user_id = $2')
    expect(calls[0]?.sql).toContain('follower_user_id = $2 AND target_user_id = $1')
    expect(calls[0]?.sql).toContain("relation_type = 'block'")
    expect(calls[0]?.sql).toContain("relation_type = 'mute'")
    expect(calls[0]?.sql).toContain('actor_user_id = $1 AND target_user_id = $2')
    expect(calls[0]?.sql).toContain('actor_user_id = $2 AND target_user_id = $1')
    expect(calls[0]?.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    expect(calls[0]?.values).toEqual(['viewer-1', 'target-1'])
  })

  it('returns no follow identifiers when the directional relationship is absent', async () => {
    const row: RelationshipGraphReadRow = {
      following: false,
      followed_by: false,
      relationship_id: null,
      created_at: null,
      blocked: true,
      blocked_by: false,
      muted: false,
    }
    const { db } = fakePostgres({ row })
    await expect(createPostgresRelationshipGraphReadStore(db).read('viewer-1', 'target-1'))
      .resolves.toEqual(row)
  })

  it('maps database failures to a sanitized service-unavailable error', async () => {
    const { db } = fakePostgres({ fail: true })
    await expect(createPostgresRelationshipGraphReadStore(db).read('viewer-1', 'target-1'))
      .rejects.toBeInstanceOf(RelationshipGraphStoreError)
  })
})
