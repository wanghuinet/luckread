import { describe, expect, it, vi } from 'vitest'
import { NotificationPushFanoutStoreError } from './notification-push-fanout-store.js'
import {
  createPostgresNotificationPushFanoutStore,
  type NotificationPushFanoutPostgresExecutor,
} from './notification-push-fanout-store-postgres.js'

describe('W05 notification push fan-out stores', () => {
  it('uses a single PostgreSQL CTE to lock, insert deliveries and transition the outbox', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: NotificationPushFanoutPostgresExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        if (sql.includes('FROM social_notification_push_outbox') && sql.includes('LIMIT $1')) {
          return { rows: [{ notification_id: 'notification-1', recipient_user_id: 'recipient-1' }] as Row[] }
        }
        return { rows: [{ inserted_count: 2, transitioned_count: 1 }] as Row[] }
      },
    }
    const store = createPostgresNotificationPushFanoutStore(db)

    await expect(store.listPending(25)).resolves.toEqual([{
      notification_id: 'notification-1',
      recipient_user_id: 'recipient-1',
    }])
    await store.fanOut({
      notificationId: 'notification-1',
      deliveries: [
        { delivery_id: 'delivery-1', endpoint_id: 'endpoint-1' },
        { delivery_id: 'delivery-2', endpoint_id: 'endpoint-2' },
      ],
      endpointCount: 2,
      now: '2026-11-11T10:00:00.000Z',
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.values).toEqual([25])
    expect(calls[0]?.sql).toContain('ORDER BY created_at ASC, notification_id ASC')
    expect(calls[1]?.values).toEqual([
      'notification-1',
      '2026-11-11T10:00:00.000Z',
      ['delivery-1', 'delivery-2'],
      ['endpoint-1', 'endpoint-2'],
      2,
    ])
    expect(calls[1]?.sql).toContain('WITH eligible AS MATERIALIZED')
    expect(calls[1]?.sql).toContain('FOR UPDATE')
    expect(calls[1]?.sql).toContain('CROSS JOIN unnest($3::text[], $4::text[])')
    expect(calls[1]?.sql).toContain('ON CONFLICT (notification_id, endpoint_id) DO NOTHING')
    expect(calls[1]?.sql).toContain("status = 'FANNED_OUT'")
    expect(calls[1]?.sql).toContain('RETURNING outbox.notification_id')
  })

  it('marks no-endpoint rows with a parameterized PostgreSQL update', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const store = createPostgresNotificationPushFanoutStore({ query } as unknown as NotificationPushFanoutPostgresExecutor)
    await store.markNoEndpoint('notification-2', '2026-11-11T10:00:00.000Z')
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'NO_ENDPOINT'"), [
      'notification-2', '2026-11-11T10:00:00.000Z',
    ])
  })

  it('maps database failures to a sanitized service-unavailable error', async () => {
    const db = {
      async query() { throw new Error('secret-postgres-host-and-credentials') },
    } as unknown as NotificationPushFanoutPostgresExecutor
    const store = createPostgresNotificationPushFanoutStore(db)
    await expect(store.listPending(25)).rejects.toBeInstanceOf(NotificationPushFanoutStoreError)
    await expect(store.fanOut({
      notificationId: 'notification-1',
      deliveries: [{ delivery_id: 'delivery-1', endpoint_id: 'endpoint-1' }],
      endpointCount: 1,
      now: '2026-11-11T10:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'NOTIFICATION_PUSH_FANOUT_UNAVAILABLE',
    })
  })
})
