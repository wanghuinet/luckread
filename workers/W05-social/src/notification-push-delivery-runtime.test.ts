import { describe, expect, it, vi } from 'vitest'
import {
  calculatePushRetryDelaySeconds,
  isRetryableExpoError,
  notificationPushMessage,
  runNotificationPushBatch,
} from './notification-push-delivery-runtime.js'

describe('W05 durable Expo push delivery runtime', () => {
  it('keeps push execution disabled unless explicitly enabled', async () => {
    const prepare = vi.fn()
    const env = { PUSH_DELIVERY_ENABLED: 'false', DB: { prepare }, D1_03: { prepare } } as never
    await expect(runNotificationPushBatch(env)).resolves.toEqual({
      status: 'DISABLED', fannedOut: 0, sent: 0, delivered: 0, retried: 0, failed: 0, skipped: 0,
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

  it('uses bounded exponential retry backoff', () => {
    expect(calculatePushRetryDelaySeconds(1)).toBe(30)
    expect(calculatePushRetryDelaySeconds(2)).toBe(60)
    expect(calculatePushRetryDelaySeconds(6)).toBe(960)
    expect(calculatePushRetryDelaySeconds(20)).toBe(3600)
  })

  it('retries transient provider errors but not permanent device or payload errors', () => {
    expect(isRetryableExpoError('MessageRateExceeded')).toBe(true)
    expect(isRetryableExpoError('InternalServerError')).toBe(true)
    expect(isRetryableExpoError('DeviceNotRegistered')).toBe(false)
    expect(isRetryableExpoError('MessageTooBig')).toBe(false)
    expect(isRetryableExpoError('InvalidCredentials')).toBe(false)
  })
})
