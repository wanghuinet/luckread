import { describe, expect, it, vi } from 'vitest'
import Expo from 'expo-server-sdk'
import {
  calculatePushRetryDelaySeconds,
  createPushMessageDeliveryIndex,
  deactivateInvalidEndpoint,
  isRetryableExpoError,
  notificationPushMessage,
  runNotificationPushBatch,
} from './notification-push-delivery-runtime.js'

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
})
