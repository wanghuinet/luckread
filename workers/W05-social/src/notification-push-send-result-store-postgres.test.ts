import { describe, expect, it, vi } from 'vitest'
import {
  createPostgresNotificationPushSendResultStore,
  type NotificationPushSendResultPostgresExecutor,
} from './notification-push-send-result-store-postgres.js'
import { NotificationPushSendResultStoreError } from './notification-push-send-result-store.js'

describe('W05 notification push send-result PostgreSQL store', () => {
  it('records a ticket with one parameterized lease-token compare-and-set', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: NotificationPushSendResultPostgresExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ delivery_id: 'delivery-1' }] as Row[] }
      },
    }
    const store = createPostgresNotificationPushSendResultStore(db)
    await expect(store.recordTicket({
      deliveryId: 'delivery-1',
      leaseToken: 'lease-1',
      ticketId: 'expo-ticket-1',
      nextAttemptAt: '2026-11-11T08:15:00.000Z',
      now: '2026-11-11T08:00:00.000Z',
    })).resolves.toBe(true)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain("status = 'RECEIPT_PENDING'")
    expect(calls[0]?.sql).toContain("status = 'LEASED'")
    expect(calls[0]?.sql).toContain('lease_token = $5')
    expect(calls[0]?.sql).toContain('RETURNING delivery_id')
    expect(calls[0]?.values).toEqual([
      'expo-ticket-1', '2026-11-11T08:15:00.000Z', '2026-11-11T08:00:00.000Z', 'delivery-1', 'lease-1',
    ])
  })

  it('transitions transient/permanent errors to the requested retry terminal state', async () => {
    const query = vi.fn(async () => ({ rows: [{ delivery_id: 'delivery-2' }] }))
    const db = { query } as unknown as NotificationPushSendResultPostgresExecutor
    const store = createPostgresNotificationPushSendResultStore(db)
    await expect(store.scheduleRetry({
      deliveryId: 'delivery-2',
      leaseToken: 'lease-2',
      status: 'RETRY',
      nextAttemptAt: '2026-11-11T08:01:00.000Z',
      errorCode: 'ExpoServerError',
      now: '2026-11-11T08:00:00.000Z',
    })).resolves.toBe(true)
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'LEASED'"), [
      'RETRY', '2026-11-11T08:01:00.000Z', 'ExpoServerError',
      '2026-11-11T08:00:00.000Z', 'delivery-2', 'lease-2',
    ])
  })

  it('does not apply results carrying a stale lease token', async () => {
    const db: NotificationPushSendResultPostgresExecutor = {
      async query<Row extends Record<string, unknown>>() { return { rows: [] as Row[] } },
    }
    const store = createPostgresNotificationPushSendResultStore(db)
    await expect(store.scheduleRetry({
      deliveryId: 'delivery-3',
      leaseToken: 'stale-lease',
      status: 'RETRY',
      nextAttemptAt: '2026-11-11T08:01:00.000Z',
      errorCode: 'ExpoServerError',
      now: '2026-11-11T08:00:00.000Z',
    })).resolves.toBe(false)
  })

  it('sanitizes PostgreSQL driver errors', async () => {
    const db = {
      async query() { throw new Error('private-postgres-host-and-password') },
    } as unknown as NotificationPushSendResultPostgresExecutor
    const store = createPostgresNotificationPushSendResultStore(db)
    await expect(store.recordTicket({
      deliveryId: 'delivery-4',
      leaseToken: 'lease-4',
      ticketId: 'ticket-4',
      nextAttemptAt: '2026-11-11T08:15:00.000Z',
      now: '2026-11-11T08:00:00.000Z',
    })).rejects.toBeInstanceOf(NotificationPushSendResultStoreError)
  })
})
