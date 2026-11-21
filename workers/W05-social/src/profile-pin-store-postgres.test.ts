import { describe, expect, it } from 'vitest'
import { ProfilePinStoreError } from './profile-pin-store.js'
import {
  createPostgresProfilePinStore,
  type ProfilePinPostgresQueryExecutor,
} from './profile-pin-store-postgres.js'

describe('W05 PostgreSQL profile pin store', () => {
  it('upserts one owner pin and preserves the original timestamp for the same content', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: ProfilePinPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{
          user_id: 'owner-1', content_id: 'content-1', pinned_at: '2026-11-10T00:00:00.000Z',
        }] as unknown as Row[] }
      },
    }
    await expect(createPostgresProfilePinStore(db).pin('owner-1', 'content-1', '2026-11-10T00:00:00.000Z'))
      .resolves.toEqual({ user_id: 'owner-1', content_id: 'content-1', pinned_at: '2026-11-10T00:00:00.000Z' })
    expect(calls[0]?.values).toEqual(['owner-1', 'content-1', '2026-11-10T00:00:00.000Z'])
    expect(calls[0]?.sql).toContain('ON CONFLICT (user_id) DO UPDATE')
    expect(calls[0]?.sql).toContain('WHEN social_profile_pins.content_id = EXCLUDED.content_id')
    expect(calls[0]?.sql).toContain('RETURNING')
  })

  it('reads and removes only the owner-scoped pin', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: ProfilePinPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ user_id: 'owner-2', content_id: 'content-2', pinned_at: '2026-11-10T00:00:00.000Z' }] as unknown as Row[] }
      },
    }
    const store = createPostgresProfilePinStore(db)
    await expect(store.get('owner-2')).resolves.toMatchObject({ content_id: 'content-2' })
    await expect(store.unpin('owner-2', 'content-2')).resolves.toBeUndefined()
    expect(calls[0]?.values).toEqual(['owner-2'])
    expect(calls[1]?.values).toEqual(['owner-2', 'content-2'])
    expect(calls[1]?.sql).toContain('DELETE FROM social_profile_pins WHERE user_id = $1 AND content_id = $2')
  })

  it('sanitizes database failures', async () => {
    const db: ProfilePinPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() { throw new Error('private-host-driver-detail') },
    }
    await expect(createPostgresProfilePinStore(db).get('owner-1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE', status: 503, message: 'PROFILE_PIN_STORE_UNAVAILABLE',
    })
    await expect(createPostgresProfilePinStore(db).unpin('owner-1', 'content-1'))
      .rejects.toBeInstanceOf(ProfilePinStoreError)
  })
})
