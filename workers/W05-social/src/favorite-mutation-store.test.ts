import { describe, expect, it, vi } from 'vitest'
import {
  createD1FavoriteMutationStore,
  FavoriteMutationStoreError,
  type FavoriteMutationD1Executor,
} from './favorite-mutation-store.js'

describe('W05 favorite mutation D1 store', () => {
  it('preserves the existing favorite identity and timestamp on duplicate create', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const row = {
      relationship_id: 'favorite-existing',
      actor_user_id: 'actor-1',
      target_type: 'content' as const,
      target_id: 'content-1',
      created_at: '2026-11-11T08:00:00.123Z',
    }
    const db: FavoriteMutationD1Executor = {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values })
            return {
              async first<Row>() { return row as Row },
              async run() { return { success: true } },
            }
          },
        }
      },
    }
    const result = await createD1FavoriteMutationStore(db).create({
      relationshipId: 'favorite-new',
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: '2026-11-11T09:00:00.000Z',
    })

    expect(result).toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('ON CONFLICT(actor_user_id, target_type, target_id)')
    expect(calls[0]?.sql).toContain('DO UPDATE SET relationship_id = interaction_favorites.relationship_id')
    expect(calls[0]?.sql).toContain('RETURNING relationship_id, actor_user_id, target_type, target_id, created_at')
    expect(calls[0]?.values).toEqual(['favorite-new', 'actor-1', 'content-1', '2026-11-11T09:00:00.000Z'])
  })

  it('removes only the actor-scoped content favorite and remains idempotent', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: FavoriteMutationD1Executor = {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values })
            return {
              async first<Row>() { return null },
              async run() { return { meta: { changes: 0 } } },
            }
          },
        }
      },
    }

    await expect(createD1FavoriteMutationStore(db).remove({
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
    })).resolves.toBeUndefined()
    expect(calls[0]?.sql).toContain('DELETE FROM interaction_favorites')
    expect(calls[0]?.sql).toContain('actor_user_id = ? AND target_type = ? AND target_id = ?')
    expect(calls[0]?.values).toEqual(['actor-1', 'content', 'content-1'])
  })

  it('sanitizes D1 failures for both create and remove', async () => {
    const broken: FavoriteMutationD1Executor = {
      prepare() {
        return {
          bind() {
            return {
              async first<Row>() { throw new Error('private D1 connection string') },
              async run() { throw new Error('private D1 connection string') },
            }
          },
        }
      },
    }
    const store = createD1FavoriteMutationStore(broken)
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
