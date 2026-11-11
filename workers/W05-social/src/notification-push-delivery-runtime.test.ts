import { describe, expect, it, vi } from 'vitest'
import Expo from 'expo-server-sdk'
import {
  calculatePushRetryDelaySeconds,
  createPushMessageDeliveryIndex,
  deactivateInvalidEndpoint,
  isRetryableExpoError,
  notificationPushMessage,
  runNotificationPushBatch,
  claimDueDeliveries,
  claimDueReceipts,
} from './notification-push-delivery-runtime.js'
import type { NotificationPushDeliveryClaimStore } from './notification-push-delivery-claim-store.js'
import type { NotificationPushReceiptStore } from './notification-push-receipt-store.js'

describe('W05 durable Expo push delivery runtime', () => {
  it('keeps push execution disabled unless explicitly enabled', async () => {
    const prepare = vi.fn()
    const env = { PUSH_DELIVERY_ENABLED: 'false', DB: { prepare }, D1_03: { prepare } } as never
    await expect(runNotificationPushBatch(env)).resolves.toEqual({
      status: 'DISABLED', fannedOut: 0, sent: 0, providerAccepted: 0, retried: 0, failed: 0, skipped: 0,
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed when the delegated W05 D1-03 binding is absent', async () => {
    const env = { PUSH_DELIVERY_ENABLED: 'true', DB: { prepare: vi.fn() } } as never
    await expect(runNotificationPushBatch(env)).rejects.toThrow('W05_PUSH_DELIVERY_D1_BINDING_MISSING')
  })

  it('uses a stable inbox notification ID and never puts the push token in payload data', () => {
    const message = notificationPushMessage({
      notificationId: 'notification-001',
      pushToken: 'ExponentPushToken[private-token-value]',
      notificationType: 'MENTION',
      targetType: 'content',
      targetId: 'content-001',
    })
    expect(message).toMatchObject({
      title: 'LuckRead', body: '有人提及了你', channelId: 'default',
      data: { notificationId: 'notification-001', type: 'MENTION', targetType: 'content', targetId: 'content-001' },
    })
    expect(JSON.stringify(message.data)).not.toContain('private-token-value')
  })


  it('keeps distinct delivery tasks for multiple notifications sent to the same Expo token', () => {
    const sharedToken = 'ExponentPushToken[shared_device_token_1234567890]'
    const tasks = [
      {
        notificationId: 'notification-like-1',
        pushToken: sharedToken,
        notificationType: 'LIKE' as const,
        targetType: 'content' as const,
        targetId: 'content-1',
      },
      {
        notificationId: 'notification-comment-2',
        pushToken: sharedToken,
        notificationType: 'COMMENT' as const,
        targetType: 'content' as const,
        targetId: 'content-2',
      },
    ]

    const { messages, taskByMessage } = createPushMessageDeliveryIndex(tasks)
    const chunks = new Expo().chunkPushNotifications(messages)
    const chunkedMessages = chunks.flat()

    expect(messages).toHaveLength(2)
    expect(messages[0]?.to).toBe(sharedToken)
    expect(messages[1]?.to).toBe(sharedToken)
    expect(messages[0]).not.toBe(messages[1])
    // expo-server-sdk@8.0.0 keeps each single-recipient message object intact
    // when chunking, so delivery identity survives the SDK boundary.
    expect(chunkedMessages[0]).toBe(messages[0])
    expect(chunkedMessages[1]).toBe(messages[1])
    expect(taskByMessage.get(chunkedMessages[0]!)).toBe(tasks[0])
    expect(taskByMessage.get(chunkedMessages[1]!)).toBe(tasks[1])
    expect(chunkedMessages.map((message) => message.data?.notificationId)).toEqual([
      'notification-like-1',
      'notification-comment-2',
    ])
  })

  it('uses bounded exponential retry backoff', () => {
    expect(calculatePushRetryDelaySeconds(1)).toBe(30)
    expect(calculatePushRetryDelaySeconds(2)).toBe(60)
    expect(calculatePushRetryDelaySeconds(6)).toBe(960)
    expect(calculatePushRetryDelaySeconds(20)).toBe(3600)
  })


  it('does not clear a rotated token when an older Expo receipt reports DeviceNotRegistered', async () => {
    const oldToken = 'ExponentPushToken[old_token_1234567890]'
    const newToken = 'ExponentPushToken[new_token_1234567890]'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(oldToken))
    const oldTokenHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
    const update = vi.fn(async () => ({ success: true, meta: { changes: 1 } }))
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (..._values: unknown[]) => ({
          first: async () => sql.startsWith('SELECT') ? { push_token: newToken } : null,
          run: update,
        }),
      })),
    } as unknown as D1Database

    await expect(deactivateInvalidEndpoint(db, {
      endpointId: 'endpoint-1',
      recipientUserId: 'recipient-1',
      pushTokenHash: oldTokenHash,
    }, new Date('2026-11-04T00:00:00.000Z'))).resolves.toBe(false)

    expect(update).not.toHaveBeenCalled()
  })

  it('clears only the exact current Expo token and never rewrites last_seen_at', async () => {
    const currentToken = 'ExponentPushToken[current_token_12345678]'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(currentToken))
    const currentTokenHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
    let updateSql = ''
    let updateBindings: unknown[] = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...values: unknown[]) => {
          if (sql.startsWith('UPDATE')) {
            updateSql = sql
            updateBindings = values
            return { run: async () => ({ success: true, meta: { changes: 1 } }) }
          }
          return { first: async () => ({ push_token: currentToken }) }
        },
      })),
    } as unknown as D1Database

    await expect(deactivateInvalidEndpoint(db, {
      endpointId: 'endpoint-1',
      recipientUserId: 'recipient-1',
      pushTokenHash: currentTokenHash,
    }, new Date('2026-11-04T00:00:00.000Z'))).resolves.toBe(true)

    expect(updateSql).toContain("permission_status = 'undetermined'")
    expect(updateSql).toContain('AND push_token = ?')
    expect(updateSql).not.toContain('last_seen_at')
    expect(updateBindings).toEqual([
      '2026-11-04T00:00:00.000Z',
      'endpoint-1',
      'recipient-1',
      'expo',
      currentToken,
    ])
  })

  it('retries transient provider errors but not permanent device or payload errors', () => {
    expect(isRetryableExpoError('MessageRateExceeded')).toBe(true)
    expect(isRetryableExpoError('InternalServerError')).toBe(true)
    expect(isRetryableExpoError('DeviceNotRegistered')).toBe(false)
    expect(isRetryableExpoError('MessageTooBig')).toBe(false)
    expect(isRetryableExpoError('InvalidCredentials')).toBe(false)
  })

  it('keeps endpoint reads on W09 D1-03 and stores only a token hash in W05', async () => {
    const candidate = {
      delivery_id:'delivery-1', notification_id:'notification-1', endpoint_id:'endpoint-1',
      lease_token:'lease-1', attempt_count:2, recipient_user_id:'recipient-1',
      notification_type:'LIKE' as const, target_type:'content' as const, target_id:'content-1',
    }
    const savePushTokenHash = vi.fn(async () => true)
    const store: NotificationPushDeliveryClaimStore = {
      claimDue: vi.fn(async () => [candidate]),
      cancel: vi.fn(async () => true),
      savePushTokenHash,
    }
    const token = 'ExponentPushToken[private-token-value]'
    const endpointDb = {
      prepare: vi.fn(() => ({bind: (..._values: unknown[]) => ({
        first: async () => ({endpoint_id:'endpoint-1',owner_user_id:'recipient-1',push_token:token}),
      })})),
    } as unknown as D1Database

    const result = await claimDueDeliveries(store, endpointDb, new Date('2026-11-11T08:00:00.000Z'))
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    const expectedHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,'0')).join('')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({deliveryId:'delivery-1',pushTokenHash:expectedHash,pushToken:token,leaseToken:'lease-1'})
    expect(endpointDb.prepare).toHaveBeenCalledWith(expect.stringContaining('FROM notification_push_endpoints'))
    expect(savePushTokenHash).toHaveBeenCalledWith({
      deliveryId:'delivery-1',leaseToken:'lease-1',pushTokenHash:expectedHash,now:'2026-11-11T08:00:00.000Z',
    })
    expect(JSON.stringify(savePushTokenHash.mock.calls)).not.toContain(token)
  })

  it('cancels deliveries with missing W09 endpoints', async () => {
    const candidate = {
      delivery_id:'delivery-2',notification_id:'notification-2',endpoint_id:'endpoint-2',
      lease_token:'lease-2',attempt_count:1,recipient_user_id:'recipient-2',
      notification_type:'COMMENT' as const,target_type:'content' as const,target_id:'content-2',
    }
    const store: NotificationPushDeliveryClaimStore = {
      claimDue: vi.fn(async () => [candidate]),
      cancel: vi.fn(async () => true),
      savePushTokenHash: vi.fn(async () => true),
    }
    const endpointDb = {prepare:()=>({bind:()=>({first:async()=>null})})} as unknown as D1Database
    await expect(claimDueDeliveries(store,endpointDb,new Date('2026-11-11T08:00:00.000Z'))).resolves.toEqual([])
    expect(store.cancel).toHaveBeenCalledWith({
      deliveryId:'delivery-2',leaseToken:'lease-2',reason:'ENDPOINT_NOT_ACTIVE',now:'2026-11-11T08:00:00.000Z',
    })
    expect(store.savePushTokenHash).not.toHaveBeenCalled()
  })

  it('skips a lease superseded before the token-hash snapshot', async () => {
    const candidate = {
      delivery_id:'delivery-3',notification_id:'notification-3',endpoint_id:'endpoint-3',
      lease_token:'stale-lease',attempt_count:1,recipient_user_id:'recipient-3',
      notification_type:'FOLLOW' as const,target_type:'user' as const,target_id:'user-3',
    }
    const store: NotificationPushDeliveryClaimStore = {
      claimDue: vi.fn(async () => [candidate]),cancel: vi.fn(async () => true),
      savePushTokenHash: vi.fn(async () => false),
    }
    const endpointDb = {prepare:()=>({bind:()=>({first:async()=>({
      endpoint_id:'endpoint-3',owner_user_id:'recipient-3',push_token:'ExponentPushToken[stale]',
    })})})} as unknown as D1Database
    await expect(claimDueDeliveries(store,endpointDb,new Date('2026-11-11T08:00:00.000Z'))).resolves.toEqual([])
  })

  it('cancels deliveries missing W05 notification context without querying W09', async () => {
    const candidate = {
      delivery_id:'delivery-4',notification_id:'notification-missing',endpoint_id:'endpoint-4',
      lease_token:'lease-4',attempt_count:1,recipient_user_id:null,
      notification_type:null,target_type:null,target_id:null,
    }
    const store: NotificationPushDeliveryClaimStore = {
      claimDue: vi.fn(async () => [candidate]),cancel: vi.fn(async () => true),
      savePushTokenHash: vi.fn(async () => true),
    }
    const endpointDb = {prepare:vi.fn()} as unknown as D1Database
    await expect(claimDueDeliveries(store,endpointDb,new Date('2026-11-11T08:00:00.000Z'))).resolves.toEqual([])
    expect(store.cancel).toHaveBeenCalledWith({
      deliveryId:'delivery-4',leaseToken:'lease-4',reason:'NOTIFICATION_NOT_FOUND',now:'2026-11-11T08:00:00.000Z',
    })
    expect(endpointDb.prepare).not.toHaveBeenCalled()
  })

  it('cancels claimed receipts whose W05 outbox owner is missing',async()=>{
    const candidate={
      delivery_id:'receipt-1',notification_id:'notification-1',endpoint_id:'endpoint-1',
      expo_ticket_id:'ticket-1',lease_token:'lease-1',attempt_count:2,receipt_poll_count:3,
      push_token_hash:'a'.repeat(64),recipient_user_id:null,
    }
    const cancelMissingOutbox=vi.fn(async()=>true)
    const store:NotificationPushReceiptStore={
      claimDue:vi.fn(async()=>[candidate]),cancelMissingOutbox,
      deferReceipt:vi.fn(async()=>true),timeoutReceipt:vi.fn(async()=>true),
      acceptReceipt:vi.fn(async()=>true),failReceipt:vi.fn(async()=>true),
    }
    await expect(claimDueReceipts(store,new Date('2026-11-11T08:00:00.000Z'))).resolves.toEqual([])
    expect(cancelMissingOutbox).toHaveBeenCalledWith({
      deliveryId:'receipt-1',leaseToken:'lease-1',now:'2026-11-11T08:00:00.000Z',
    })
  })


})
