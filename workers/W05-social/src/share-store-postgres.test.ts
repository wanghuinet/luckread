import { describe, expect, it } from 'vitest'
import { ShareStoreError } from './share-store.js'
import {
  createPostgresShareStore,
  type SharePostgresQueryExecutor,
} from './share-store-postgres.js'

describe('W05 PostgreSQL share store', () => {
  it('looks up the actor-scoped idempotency key', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: SharePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ share_id: 'share-1', content_id: 'content-1', actor_user_id: 'actor-1', created_at: '2026-11-10T00:00:00.000Z' }] as unknown as Row[] }
      },
    }
    await expect(createPostgresShareStore(db).findByActorAndKey('actor-1', 'key-1'))
      .resolves.toMatchObject({ share_id: 'share-1', content_id: 'content-1' })
    expect(calls[0]?.values).toEqual(['actor-1', 'key-1'])
    expect(calls[0]?.sql).toContain('WHERE actor_user_id = $1 AND idempotency_key = $2')
  })

  it('uses actor+key conflict handling and share-id lookup', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: SharePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ share_id: 'share-1', content_id: 'content-1', created_at: '2026-11-10T00:00:00.000Z' }] as unknown as Row[] }
      },
    }
    const store = createPostgresShareStore(db)
    await expect(store.insertIfAbsent('share-1', 'content-1', 'actor-1', 'key-1', '2026-11-10T00:00:00.000Z'))
      .resolves.toBeUndefined()
    await expect(store.findById('share-1')).resolves.toMatchObject({ share_id: 'share-1' })
    expect(calls[0]?.sql).toContain('ON CONFLICT (actor_user_id, idempotency_key) DO NOTHING')
    expect(calls[0]?.values).toEqual(['share-1', 'content-1', 'actor-1', 'key-1', '2026-11-10T00:00:00.000Z'])
    expect(calls[1]?.values).toEqual(['share-1'])
  })

  it('sanitizes provider failures', async () => {
    const db: SharePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() { throw new Error('secret-db-provider-detail') },
    }
    await expect(createPostgresShareStore(db).findById('share-1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE', status: 503, message: 'SHARE_STORE_UNAVAILABLE',
    })
  })
})
