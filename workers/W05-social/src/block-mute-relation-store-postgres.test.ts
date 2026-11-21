import { describe, expect, it } from 'vitest'

import {
  BlockMuteRelationStoreError,
  type BlockMuteRelationRow,
} from './block-mute-relation-store.js'
import {
  createPostgresBlockMuteRelationStore,
  type BlockMuteRelationPostgresQueryExecutor,
} from './block-mute-relation-store-postgres.js'
import { getRelation, removeRelation, setRelation } from './block-mute-runtime.js'

function fakePostgres(options: {
  rows?: BlockMuteRelationRow[]
  fail?: boolean
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db: BlockMuteRelationPostgresQueryExecutor = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('secret-driver-detail')
      return { rows: (options.rows ?? []) as unknown as Row[] }
    },
  }
  return { db, calls }
}

const row: BlockMuteRelationRow = {
  relationship_id: 'relation-original',
  actor_user_id: 'viewer-1',
  target_user_id: 'target-1',
  relation_type: 'block',
  created_at: '2026-11-10T04:05:06.007Z',
  updated_at: '2026-11-10T04:05:06.007Z',
}

describe('W05 PostgreSQL Block/Mute relation store', () => {
  it('reads one relation scoped by actor, target and type', async () => {
    const { db, calls } = fakePostgres({ rows: [row] })
    const result = await createPostgresBlockMuteRelationStore(db).get({
      actorUserId: 'viewer-1',
      targetUserId: 'target-1',
      relationType: 'block',
    })

    expect(result).toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('actor_user_id = $1')
    expect(calls[0]?.sql).toContain('target_user_id = $2')
    expect(calls[0]?.sql).toContain('relation_type = $3')
    expect(calls[0]?.values).toEqual(['viewer-1', 'target-1', 'block'])
  })

  it('uses one atomic upsert and preserves the original identity and timestamps on conflict', async () => {
    const { db, calls } = fakePostgres({ rows: [row] })
    const result = await createPostgresBlockMuteRelationStore(db).set({
      relationshipId: 'relation-retry',
      actorUserId: 'viewer-1',
      targetUserId: 'target-1',
      relationType: 'block',
      createdAt: '2026-11-10T05:00:00.000Z',
      updatedAt: '2026-11-10T05:00:00.000Z',
    })

    expect(result).toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('ON CONFLICT (actor_user_id, target_user_id, relation_type)')
    expect(calls[0]?.sql).toContain('DO UPDATE SET updated_at = social_user_interactions.updated_at')
    expect(calls[0]?.sql).toContain('RETURNING')
    expect(calls[0]?.values).toEqual([
      'relation-retry',
      'viewer-1',
      'target-1',
      'block',
      '2026-11-10T05:00:00.000Z',
      '2026-11-10T05:00:00.000Z',
    ])
  })

  it('keeps Mute independent from Block under the three-column unique key', async () => {
    const { db, calls } = fakePostgres({ rows: [{ ...row, relationship_id: 'mute-original', relation_type: 'mute' }] })
    const result = await createPostgresBlockMuteRelationStore(db).set({
      relationshipId: 'mute-retry',
      actorUserId: 'viewer-1',
      targetUserId: 'target-1',
      relationType: 'mute',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })

    expect(result?.relation_type).toBe('mute')
    expect(calls[0]?.values[3]).toBe('mute')
  })

  it('removes a relation idempotently using the same actor/target/type scope', async () => {
    const { db, calls } = fakePostgres()
    await createPostgresBlockMuteRelationStore(db).remove({
      actorUserId: 'viewer-1',
      targetUserId: 'target-1',
      relationType: 'mute',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('DELETE FROM social_user_interactions')
    expect(calls[0]?.values).toEqual(['viewer-1', 'target-1', 'mute'])
  })

  it('maps driver failures to a sanitized service-unavailable error', async () => {
    const { db } = fakePostgres({ fail: true })
    const store = createPostgresBlockMuteRelationStore(db)

    await expect(store.get({
      actorUserId: 'viewer-1', targetUserId: 'target-1', relationType: 'block',
    })).rejects.toBeInstanceOf(BlockMuteRelationStoreError)
    await expect(store.set({
      relationshipId: 'relation-1',
      actorUserId: 'viewer-1',
      targetUserId: 'target-1',
      relationType: 'block',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })).rejects.toBeInstanceOf(BlockMuteRelationStoreError)
    await expect(store.remove({
      actorUserId: 'viewer-1', targetUserId: 'target-1', relationType: 'block',
    })).rejects.toBeInstanceOf(BlockMuteRelationStoreError)
  })

  it('routes injected PostgreSQL relation failures through the public runtime error contract', async () => {
    const { db } = fakePostgres({ fail: true })
    const store = createPostgresBlockMuteRelationStore(db)

    await expect(getRelation(store, 'viewer-1', 'target-1', 'block'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(setRelation(store, 'viewer-1', 'target-1', 'mute'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(removeRelation(store, 'viewer-1', 'target-1', 'block'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
