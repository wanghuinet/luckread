import { describe, expect, it } from 'vitest'

import { BlockMuteListReadStoreError } from './block-mute-list-read-store.js'
import { createPostgresBlockMuteListReadStore } from './block-mute-list-read-store-postgres.js'
import { listRelations } from './block-mute-runtime.js'
import type { BlockMuteListReadRow } from './block-mute-list-read-store.js'

function fakePostgres(options: {
  rows?: BlockMuteListReadRow[]
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

describe('W05 PostgreSQL Block/Mute list read store', () => {
  it('reads a bounded Block page scoped to the actor and relation type', async () => {
    const rows: BlockMuteListReadRow[] = [{
      relationship_id: 'block-r1',
      target_user_id: 'blocked-user',
      created_at: '2026-11-10T04:05:06.007Z',
      cursor_created_at: '2026-11-10T04:05:06.007900Z',
    }]
    const { db, calls } = fakePostgres({ rows })
    const result = await createPostgresBlockMuteListReadStore(db)
      .list({ actorUserId: 'viewer-1', relationType: 'block', cursor: null, limit: 20 })

    expect(result).toEqual(rows)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('actor_user_id = $1')
    expect(calls[0]?.sql).toContain('relation_type = $2')
    expect(calls[0]?.sql).toContain('ORDER BY created_at DESC, relationship_id DESC')
    expect(calls[0]?.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    expect(calls[0]?.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    expect(calls[0]?.sql).toContain('AS cursor_created_at')
    expect(calls[0]?.sql).toContain('LIMIT $3')
    expect(calls[0]?.values).toEqual(['viewer-1', 'block', 21])
  })

  it('reads a Mute continuation page with an exact timestamp and relationship cursor', async () => {
    const cursor = {
      createdAt: '2026-11-10T04:05:06.007900Z',
      relationshipId: 'mute-r1',
    }
    const { db, calls } = fakePostgres()
    await createPostgresBlockMuteListReadStore(db)
      .list({ actorUserId: 'viewer-1', relationType: 'mute', cursor, limit: 10 })

    expect(calls[0]?.sql).toContain('created_at < $3::timestamptz')
    expect(calls[0]?.sql).toContain('created_at = $3::timestamptz AND relationship_id < $4')
    expect(calls[0]?.sql).toContain('LIMIT $5')
    expect(calls[0]?.values).toEqual(['viewer-1', 'mute', cursor.createdAt, cursor.relationshipId, 11])
  })

  it('maps database failures to a sanitized service-unavailable error', async () => {
    const { db } = fakePostgres({ fail: true })
    await expect(createPostgresBlockMuteListReadStore(db).list({
      actorUserId: 'viewer-1',
      relationType: 'block',
      cursor: null,
      limit: 20,
    })).rejects.toBeInstanceOf(BlockMuteListReadStoreError)
  })

  it('maps PostgreSQL list failures to the public runtime service-unavailable error', async () => {
    const { db } = fakePostgres({ fail: true })
    await expect(listRelations(
      createPostgresBlockMuteListReadStore(db),
      'viewer-runtime-error',
      'mute',
      null,
      20,
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
