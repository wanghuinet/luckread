import { describe, expect, it, vi } from 'vitest'
import {
  createPostgresFavoriteMutationStore,
  type FavoriteMutationPostgresExecutor,
} from './favorite-mutation-store-postgres.js'
import { FavoriteMutationStoreError } from './favorite-mutation-store.js'

describe('W05 favorite mutation PostgreSQL store', () => {
  it('uses a parameterized idempotent upsert and returns the existing relationship identity', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const row = {
      relationship_id: 'favorite-existing',
      actor_user_id: 'actor-1',
      target_type: 'content',
      target_id: 'content-1',
      created_at: '2026-11-11T08:00:00.123Z',
    }
    const db: FavoriteMutationPostgresExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [row as Row] }
      },
    }
    const result = await createPostgresFavoriteMutationStore(db).create({
      relationshipId: 'favorite-new',
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: '2026-11-11T09:00:00.000Z',
    })

    expect(result).toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('ON CONFLICT (actor_user_id, target_type, target_id)')
    expect(calls[0]?.sql).toContain('DO UPDATE SET relationship_id = interaction_favorites.relationship_id')
    expect(calls[0]?.sql).toContain('RETURNING')
    expect(calls[0]?.sql).toContain("to_char(created_at AT TIME ZONE 'UTC'")
    expect(calls[0]?.values).toEqual(['favorite-new', 'actor-1', 'content-1', '2026-11-11T09:00:00.000Z'])
  })

  it('removes only the requested actor-scoped favorite', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: FavoriteMutationPostgresExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [] }
      },
    }
    await expect(createPostgresFavoriteMutationStore(db).remove({
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
    })).resolves.toBeUndefined()
    expect(calls[0]?.sql).toContain('DELETE FROM interaction_favorites')
    expect(calls[0]?.sql).toContain('actor_user_id = $1')
    expect(calls[0]?.sql).toContain('target_type = $2')
    expect(calls[0]?.sql).toContain('target_id = $3')
    expect(calls[0]?.values).toEqual(['actor-1', 'content', 'content-1'])
  })

  it('returns a stable sanitized error for PostgreSQL failures', async () => {
    const query = vi.fn(async () => { throw new Error('postgres://private:secret@host/db') })
    const store = createPostgresFavoriteMutationStore({
      query,
    } as unknown as FavoriteMutationPostgresExecutor)

    await expect(store.create({
      relationshipId: 'favorite-1',
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: '2026-11-11T08:00:00.000Z',
    })).rejects.toBeInstanceOf(FavoriteMutationStoreError)

    await expect(store.remove({
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
    })).rejects.toThrow('FAVORITE_MUTATION_STORE_UNAVAILABLE')
  })
})
