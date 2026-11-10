import { describe, expect, it, vi } from 'vitest'
import {
  createD1NotificationPushSendResultStore,
  NotificationPushSendResultStoreError,
  type NotificationPushSendResultD1Executor,
} from './notification-push-send-result-store.js'

describe('W05 notification push send-result D1 store', () => {
  it('records an Expo ticket only for the current LEASED row and clears the send lease', async () => {
    let sql = ''
    let values: unknown[] = []
    const db: NotificationPushSendResultD1Executor = {
      prepare(statement) {
        sql = statement
        return {
          bind(...bindings) {
            values = bindings
            return { async run() { return { meta: { changes: 1 } } } }
          },
        }
      },
    }
    const store = createD1NotificationPushSendResultStore(db)

    await expect(store.recordTicket({
      deliveryId: 'delivery-1',
      leaseToken: 'lease-1',
      ticketId: 'expo-ticket-1',
      nextAttemptAt: '2026-11-11T08:15:00.000Z',
      now: '2026-11-11T08:00:00.000Z',
    })).resolves.toBe(true)

    expect(sql).toContain("status = 'RECEIPT_PENDING'")
    expect(sql).toContain("status = 'LEASED' AND lease_token = ?")
    expect(sql).toContain('lease_token = NULL')
    expect(sql).toContain('lease_expires_at = NULL')
    expect(values).toEqual([
      'expo-ticket-1', '2026-11-11T08:15:00.000Z', '2026-11-11T08:00:00.000Z', 'delivery-1', 'lease-1',
    ])
  })

  it('returns false when a stale or superseded send lease no longer matches', async () => {
    const db: NotificationPushSendResultD1Executor = {
      prepare() {
        return { bind() { return { async run() { return { meta: { changes: 0 } } } } } }
      },
    }
    const store = createD1NotificationPushSendResultStore(db)
    await expect(store.scheduleRetry({
      deliveryId: 'delivery-1',
      leaseToken: 'old-lease',
      status: 'RETRY',
      nextAttemptAt: '2026-11-11T08:01:00.000Z',
      errorCode: 'ExpoServerError',
      now: '2026-11-11T08:00:00.000Z',
    })).resolves.toBe(false)
  })

  it('sets retry status, bounded retry time and the provider error code through bound values', async () => {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }))
    let sql = ''
    let values: unknown[] = []
    const db: NotificationPushSendResultD1Executor = {
      prepare(statement) {
        sql = statement
        return { bind(...bindings) { values = bindings; return { run } } }
      },
    }
    const store = createD1NotificationPushSendResultStore(db)
    await expect(store.scheduleRetry({
      deliveryId: 'delivery-2',
      leaseToken: 'lease-2',
      status: 'FAILED',
      nextAttemptAt: '2026-11-11T08:00:00.000Z',
      errorCode: 'DeviceNotRegistered',
      now: '2026-11-11T08:00:00.000Z',
    })).resolves.toBe(true)

    expect(sql).toContain('status = ?')
    expect(sql).toContain('expo_ticket_id = NULL')
    expect(sql).toContain("status = 'LEASED' AND lease_token = ?")
    expect(values).toEqual([
      'FAILED', '2026-11-11T08:00:00.000Z', 'DeviceNotRegistered',
      '2026-11-11T08:00:00.000Z', 'delivery-2', 'lease-2',
    ])
  })

  it('sanitizes D1 failures', async () => {
    const db = {
      prepare() {
        return { bind() { return { async run() { throw new Error('private driver metadata') } } } }
      },
    } as unknown as NotificationPushSendResultD1Executor
    const store = createD1NotificationPushSendResultStore(db)
    await expect(store.recordTicket({
      deliveryId: 'delivery-3',
      leaseToken: 'lease-3',
      ticketId: 'ticket-3',
      nextAttemptAt: '2026-11-11T08:15:00.000Z',
      now: '2026-11-11T08:00:00.000Z',
    })).rejects.toBeInstanceOf(NotificationPushSendResultStoreError)
  })
})
