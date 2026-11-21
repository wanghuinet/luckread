import { describe, expect, it, vi } from 'vitest'
import { NotificationPreferencesStoreError } from './notification-preferences-store.js'
import {
  createPostgresNotificationPreferencesStore,
  type NotificationPreferencesPostgresQueryExecutor,
} from './notification-preferences-store-postgres.js'

describe('W05 PostgreSQL notification preferences store', () => {
  it('returns default-on preferences when the user has no stored row', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const store = createPostgresNotificationPreferencesStore({
      query,
    } as unknown as NotificationPreferencesPostgresQueryExecutor)

    await expect(store.get('user-new')).resolves.toEqual({
      follow: true,
      like: true,
      comment: true,
      mention: true,
    })
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM social_notification_preferences WHERE user_id = $1'),
      ['user-new'],
    )
  })

  it('performs an actor-scoped partial upsert without overwriting unspecified preferences', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: NotificationPreferencesPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return {
          rows: [{
            follow_enabled: 0,
            like_enabled: 1,
            comment_enabled: 0,
            mention_enabled: 0,
          }] as unknown as Row[],
        }
      },
    }

    await expect(createPostgresNotificationPreferencesStore(db).set('user-1', {
      like: true,
      mention: false,
    })).resolves.toEqual({
      follow: false,
      like: true,
      comment: false,
      mention: false,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['user-1', null, 1, null, 0, null, 1, null, 0])
    expect(calls[0]?.sql).toContain('ON CONFLICT(user_id) DO UPDATE')
    expect(calls[0]?.sql).toContain('follow_enabled = COALESCE($6, social_notification_preferences.follow_enabled)')
    expect(calls[0]?.sql).toContain('RETURNING follow_enabled, like_enabled, comment_enabled, mention_enabled')
  })

  it('uses defaults for omitted fields on first insert', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: NotificationPreferencesPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return {
          rows: [{
            follow_enabled: 1,
            like_enabled: 1,
            comment_enabled: 0,
            mention_enabled: 1,
          }] as unknown as Row[],
        }
      },
    }

    await expect(createPostgresNotificationPreferencesStore(db).set('user-new', {
      comment: false,
    })).resolves.toEqual({
      follow: true,
      like: true,
      comment: false,
      mention: true,
    })
    expect(calls[0]?.values).toEqual(['user-new', null, null, 0, null, null, null, 0, null])
  })

  it('maps provider errors and missing RETURNING rows to sanitized store errors', async () => {
    const brokenDb: NotificationPreferencesPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('private-neon-host-and-auth-detail')
      },
    }
    const store = createPostgresNotificationPreferencesStore(brokenDb)
    await expect(store.get('user-1')).rejects.toBeInstanceOf(NotificationPreferencesStoreError)
    await expect(store.set('user-1', { like: false })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'NOTIFICATION_PREFERENCES_STORE_UNAVAILABLE',
    })

    const emptyReturningDb: NotificationPreferencesPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        return { rows: [] as Row[] }
      },
    }
    await expect(createPostgresNotificationPreferencesStore(emptyReturningDb).set('user-1', { like: false }))
      .rejects.toBeInstanceOf(NotificationPreferencesStoreError)
  })
})
