import { describe, expect, it } from 'vitest'
import { RepostStoreError } from './repost-store.js'
import {
  createPostgresRepostStore,
  type RepostPostgresQueryExecutor,
} from './repost-store-postgres.js'

describe('W05 PostgreSQL repost store', () => {
  it('checks blocks in both directions with parameterized actor and owner ids', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: RepostPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ blocked: true }] as unknown as Row[] }
      },
    }
    await expect(createPostgresRepostStore(db).isBlocked('actor-1', 'owner-1')).resolves.toBe(true)
    expect(calls[0]?.values).toEqual(['actor-1', 'owner-1'])
    expect(calls[0]?.sql).toContain("block.relation_type = 'block'")
    expect(calls[0]?.sql).toContain('block.actor_user_id = $2 AND block.target_user_id = $1')
  })

  it('short-circuits self and absent owners without a query', async () => {
    const query = async () => { throw new Error('must not query') }
    const store = createPostgresRepostStore({ query } as unknown as RepostPostgresQueryExecutor)
    await expect(store.isBlocked('user-1', 'user-1')).resolves.toBe(false)
    await expect(store.isBlocked('user-1', null)).resolves.toBe(false)
  })

  it('uses idempotent insert and actor-scoped relation lookup/removal', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: RepostPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ repost_id: 'repost-1', content_id: 'content-1', actor_user_id: 'actor-1', created_at: '2026-11-10T00:00:00.000Z' }] as unknown as Row[] }
      },
    }
    const store = createPostgresRepostStore(db)
    await expect(store.find('actor-1', 'content-1')).resolves.toMatchObject({ repost_id: 'repost-1' })
    await expect(store.insertIfAbsent('repost-1', 'content-1', 'actor-1', '2026-11-10T00:00:00.000Z')).resolves.toBeUndefined()
    await expect(store.remove('actor-1', 'content-1')).resolves.toBeUndefined()
    expect(calls[0]?.values).toEqual(['actor-1', 'content-1'])
    expect(calls[1]?.sql).toContain('ON CONFLICT (actor_user_id, content_id) DO NOTHING')
    expect(calls[1]?.values).toEqual(['repost-1', 'content-1', 'actor-1', '2026-11-10T00:00:00.000Z'])
    expect(calls[2]?.sql).toContain('DELETE FROM social_reposts WHERE actor_user_id = $1 AND content_id = $2')
  })

  it('sanitizes provider failures', async () => {
    const db: RepostPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() { throw new Error('private-db-url') },
    }
    await expect(createPostgresRepostStore(db).find('actor-1', 'content-1')).rejects.toBeInstanceOf(RepostStoreError)
  })
})
