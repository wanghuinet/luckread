import { describe, expect, it } from 'vitest'
import {
  createD1NotificationPushDeliveryClaimStore,
  type NotificationPushDeliveryClaimD1Executor,
} from './notification-push-delivery-claim-store-d1.js'

describe('W05 notification push delivery claim D1 store', () => {
  it('recovers exhausted leases, claims due rows and joins notification context', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const candidates = [
      { delivery_id: 'delivery-1', notification_id: 'notification-1', endpoint_id: 'endpoint-1' },
      { delivery_id: 'delivery-2', notification_id: 'notification-2', endpoint_id: 'endpoint-2' },
    ]
    let claimedIndex = 0
    const db: NotificationPushDeliveryClaimD1Executor = {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values })
            return {
              async all<Row>() { return { results: candidates as Row[] } },
              async first<Row>() {
                if (sql.startsWith('UPDATE') && sql.includes('RETURNING delivery_id')) {
                  const candidate = candidates[claimedIndex++]
                  return candidate ? {...candidate, attempt_count: claimedIndex} as Row : null
                }
                if (sql.startsWith('SELECT o.recipient_user_id')) {
                  return {
                    recipient_user_id: 'recipient-' + claimedIndex,
                    notification_type: 'LIKE',
                    target_type: 'content',
                    target_id: 'content-' + claimedIndex,
                  } as Row
                }
                return null
              },
              async run() { return { meta: { changes: 1 } } },
            }
          },
        }
      },
    }
    const rows = await createD1NotificationPushDeliveryClaimStore(db).claimDue({
      now: '2026-11-11T08:00:00.000Z',
      leaseExpiresAt: '2026-11-11T08:03:00.000Z',
      limit: 2,
      maxAttempts: 6,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      delivery_id: 'delivery-1',
      attempt_count: 1,
      recipient_user_id: 'recipient-1',
      notification_type: 'LIKE',
      target_type: 'content',
      target_id: 'content-1',
    })
    expect(rows.every(row => row.lease_token.length > 0)).toBe(true)
    expect(calls[0]?.sql).toContain("last_error_code = 'SEND_LEASE_EXPIRED_MAX_ATTEMPTS'")
    expect(calls[1]?.sql).toContain('ORDER BY next_attempt_at ASC, created_at ASC, delivery_id ASC LIMIT ?')
    expect(calls[2]?.sql).toContain("status = 'LEASED'")
  })

  it('uses lease-token CAS for cancellation and token-hash snapshots', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: NotificationPushDeliveryClaimD1Executor = {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values })
            return {
              async all<Row>() { return { results: [] as Row[] } },
              async first<Row>() { return null },
              async run() { return { meta: { changes: 1 } } },
            }
          },
        }
      },
    }
    const store = createD1NotificationPushDeliveryClaimStore(db)
    await expect(store.cancel({
      deliveryId: 'delivery-1', leaseToken: 'lease-1', reason: 'ENDPOINT_NOT_ACTIVE',
      now: '2026-11-11T08:00:00.000Z',
    })).resolves.toBe(true)
    await expect(store.savePushTokenHash({
      deliveryId: 'delivery-1', leaseToken: 'lease-1', pushTokenHash: 'sha256-hash',
      now: '2026-11-11T08:00:00.000Z',
    })).resolves.toBe(true)
    expect(calls[0]?.sql).toContain("status = 'LEASED' AND lease_token = ?")
    expect(calls[1]?.sql).toContain("status = 'LEASED' AND lease_token = ?")
  })

  it('sanitizes D1 failures', async () => {
    const db = {
      prepare() { return { bind() {
        return {
          async all() { throw new Error('private D1 failure metadata') },
          async first() { return null },
          async run() { return { meta: { changes: 1 } } },
        }
      } } },
    } as unknown as NotificationPushDeliveryClaimD1Executor
    await expect(createD1NotificationPushDeliveryClaimStore(db).claimDue({
      now: '2026-11-11T08:00:00.000Z',
      leaseExpiresAt: '2026-11-11T08:03:00.000Z',
      limit: 100, maxAttempts: 6,
    })).rejects.toThrow('NOTIFICATION_PUSH_DELIVERY_CLAIM_UNAVAILABLE')
  })
})
