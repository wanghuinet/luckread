import { describe, expect, it, vi } from 'vitest'

import { createD1NotificationEnqueueStore } from './notification-enqueue-store.js'
import type { NotificationEnqueueInput } from './notification-enqueue-store.js'

const input: NotificationEnqueueInput = {
  notificationId: 'notification-1',
  recipientUserId: 'recipient-1',
  actorUserId: 'actor-1',
  notificationType: 'COMMENT',
  targetType: 'content',
  targetId: 'content-1',
  dedupeKey: 'COMMENT:recipient-1:actor-1:content:content-1',
  payloadJson: '{"eventId":"event-1"}',
  createdAt: '2026-11-10T00:00:00.000Z',
}

function fakeD1(options: {
  blocked?: boolean
  enabled?: number | boolean | string | null
  failInsert?: boolean
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const run = vi.fn(async () => {
    if (options.failInsert) throw new Error('D1_ERROR: SQLITE_BUSY: database is locked')
    return { success: true, meta: { changes: 1 } }
  })
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          calls.push({ sql, values })
          return {
            first: async <T,>() => {
              if (sql.includes('social_user_interactions')) return (options.blocked ? { blocked: 1 } : null) as T | null
              if (sql.includes('social_notification_preferences')) {
                return options.enabled === null || options.enabled === undefined
                  ? null
                  : ({ enabled: options.enabled } as T)
              }
              return null
            },
            run,
          }
        },
      }
    },
  }
  return { db, calls, run }
}

describe('W05 D1 notification enqueue store', () => {
  it('checks both block directions, defaults missing preferences to enabled, and inserts the stable dedupe key', async () => {
    const { db, calls, run } = fakeD1()
    await createD1NotificationEnqueueStore(db).enqueue(input)

    expect(calls).toHaveLength(3)
    expect(calls[0]?.sql).toContain("relation_type = 'block'")
    expect(calls[0]?.sql).toContain('(actor_user_id = ? AND target_user_id = ?)')
    expect(calls[0]?.sql).toContain('(actor_user_id = ? AND target_user_id = ?)')
    expect(calls[0]?.values).toEqual(['actor-1', 'recipient-1', 'recipient-1', 'actor-1'])
    expect(calls[1]?.sql).toContain('comment_enabled AS enabled')
    expect(calls[1]?.values).toEqual(['recipient-1'])
    expect(calls[2]?.sql).toContain('INSERT OR IGNORE INTO social_notifications')
    expect(calls[2]?.values).toEqual([
      'notification-1', 'recipient-1', 'actor-1', 'COMMENT', 'content', 'content-1',
      input.dedupeKey, input.payloadJson, input.createdAt,
    ])
    expect(run).toHaveBeenCalledOnce()
  })

  it('does not persist when either direction is blocked', async () => {
    const { db, calls, run } = fakeD1({ blocked: true })
    await createD1NotificationEnqueueStore(db).enqueue(input)
    expect(calls).toHaveLength(1)
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    ['FOLLOW', 'follow_enabled'],
    ['LIKE', 'like_enabled'],
    ['COMMENT', 'comment_enabled'],
    ['REPLY', 'comment_enabled'],
    ['MENTION', 'mention_enabled'],
  ] as const)('uses the %s preference column', async (notificationType, column) => {
    const { db, calls, run } = fakeD1({ enabled: 0 })
    await createD1NotificationEnqueueStore(db).enqueue({ ...input, notificationType })
    expect(calls[1]?.sql).toContain(column + ' AS enabled')
    expect(run).not.toHaveBeenCalled()
  })

  it('persists despite an absent preference row, preserving default-on behavior', async () => {
    const { db, calls, run } = fakeD1({ enabled: null })
    await createD1NotificationEnqueueStore(db).enqueue({ ...input, notificationType: 'MENTION' })
    expect(calls).toHaveLength(3)
    expect(run).toHaveBeenCalledOnce()
  })
})
