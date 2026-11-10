import { describe, expect, it, vi } from 'vitest'
import {
  createPostgresNotificationPushDeliveryClaimStore,
  type NotificationPushDeliveryClaimPostgresExecutor,
} from './notification-push-delivery-claim-store-postgres.js'
import { NotificationPushDeliveryClaimStoreError } from './notification-push-delivery-claim-store.js'

describe('W05 notification push delivery claim PostgreSQL store', () => {
  it('claims bounded due rows atomically with SKIP LOCKED and returns notification context', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: NotificationPushDeliveryClaimPostgresExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({sql,values})
        return { rows: [{
          delivery_id:'delivery-1', notification_id:'notification-1', endpoint_id:'endpoint-1',
          lease_token:'lease-1', attempt_count:3, recipient_user_id:'recipient-1',
          notification_type:'COMMENT', target_type:'content', target_id:'content-1',
        }] as Row[] }
      },
    }
    const store = createPostgresNotificationPushDeliveryClaimStore(db)
    await expect(store.claimDue({
      now:'2026-11-11T08:00:00.000Z', leaseExpiresAt:'2026-11-11T08:03:00.000Z',
      limit:100, maxAttempts:6,
    })).resolves.toMatchObject([{
      delivery_id:'delivery-1', lease_token:'lease-1', attempt_count:3,
      recipient_user_id:'recipient-1', notification_type:'COMMENT',
    }])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('WITH expired_max_attempts AS')
    expect(calls[0]?.sql).toContain('FOR UPDATE OF delivery SKIP LOCKED')
    expect(calls[0]?.sql).toContain('LIMIT $1')
    expect(calls[0]?.sql).toContain('gen_random_uuid()::text')
    expect(calls[0]?.sql).toContain('LEFT JOIN social_notification_push_outbox')
    expect(calls[0]?.values).toEqual([100,6,'2026-11-11T08:00:00.000Z','2026-11-11T08:03:00.000Z'])
  })

  it('uses lease-token CAS for cancellation and token-hash snapshots', async () => {
    const calls: Array<{sql:string;values:unknown[]}> = []
    const db: NotificationPushDeliveryClaimPostgresExecutor = {
      async query<Row extends Record<string,unknown>>(sql:string,values:unknown[] = []) {
        calls.push({sql,values}); return {rows:[{delivery_id:'delivery-1'}] as Row[]}
      },
    }
    const store = createPostgresNotificationPushDeliveryClaimStore(db)
    await expect(store.cancel({
      deliveryId:'delivery-1',leaseToken:'lease-1',reason:'NOTIFICATION_NOT_FOUND',
      now:'2026-11-11T08:00:00.000Z',
    })).resolves.toBe(true)
    await expect(store.savePushTokenHash({
      deliveryId:'delivery-1',leaseToken:'lease-1',pushTokenHash:'sha256-hash',
      now:'2026-11-11T08:00:00.000Z',
    })).resolves.toBe(true)
    expect(calls[0]?.sql).toContain('lease_token = $4')
    expect(calls[1]?.sql).toContain('lease_token = $4')
    expect(calls[1]?.values).toEqual(['sha256-hash','2026-11-11T08:00:00.000Z','delivery-1','lease-1'])
  })

  it('returns false when a lease token is stale', async () => {
    const query = vi.fn(async () => ({rows:[]}))
    const store = createPostgresNotificationPushDeliveryClaimStore({query} as unknown as NotificationPushDeliveryClaimPostgresExecutor)
    await expect(store.savePushTokenHash({
      deliveryId:'delivery-1',leaseToken:'stale',pushTokenHash:'hash',
      now:'2026-11-11T08:00:00.000Z',
    })).resolves.toBe(false)
    await expect(store.cancel({
      deliveryId:'delivery-1',leaseToken:'stale',reason:'ENDPOINT_NOT_ACTIVE',
      now:'2026-11-11T08:00:00.000Z',
    })).resolves.toBe(false)
  })

  it('sanitizes PostgreSQL driver errors', async () => {
    const store = createPostgresNotificationPushDeliveryClaimStore({
      async query() { throw new Error('private postgres host and password') },
    } as unknown as NotificationPushDeliveryClaimPostgresExecutor)
    await expect(store.claimDue({
      now:'2026-11-11T08:00:00.000Z',leaseExpiresAt:'2026-11-11T08:03:00.000Z',
      limit:20,maxAttempts:6,
    })).rejects.toBeInstanceOf(NotificationPushDeliveryClaimStoreError)
  })
})
