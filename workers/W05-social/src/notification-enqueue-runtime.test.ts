import { describe, expect, it, vi } from 'vitest'

import { enqueueNotification } from './social-closure-runtime.js'
import { NotificationEnqueueStoreError } from './notification-enqueue-store.js'
import type { NotificationEnqueueInput } from './notification-enqueue-store.js'

const request = {
  recipientUserId: 'recipient-1',
  actorUserId: 'actor-1',
  type: 'COMMENT' as const,
  targetType: 'content' as const,
  targetId: 'content-1',
  payload: { eventId: 'event-1' },
}

describe('W05 notification enqueue runtime', () => {
  it('uses an injected enqueue store without requiring a D1 binding', async () => {
    const saved: NotificationEnqueueInput[] = []
    const store = {
      async enqueue(input: NotificationEnqueueInput) {
        saved.push(input)
      },
    }

    await expect(enqueueNotification(store, request)).resolves.toBeUndefined()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      recipientUserId: 'recipient-1',
      actorUserId: 'actor-1',
      notificationType: 'COMMENT',
      targetType: 'content',
      targetId: 'content-1',
      dedupeKey: 'COMMENT:recipient-1:actor-1:content:content-1',
      payloadJson: JSON.stringify(request.payload),
    })
    expect(saved[0]?.notificationId).toEqual(expect.any(String))
    expect(saved[0]?.createdAt).toEqual(expect.any(String))
  })

  it('reuses one notification ID and dedupe payload across bounded retry attempts', async () => {
    const inputs: NotificationEnqueueInput[] = []
    let attempts = 0
    const store = {
      async enqueue(input: NotificationEnqueueInput) {
        inputs.push(input)
        attempts += 1
        if (attempts < 3) throw new NotificationEnqueueStoreError(true)
      },
    }

    await expect(enqueueNotification(store, request)).resolves.toBeUndefined()
    expect(attempts).toBe(3)
    expect(inputs).toHaveLength(3)
    expect(inputs[1]).toEqual(inputs[0])
    expect(inputs[2]).toEqual(inputs[0])
  })

  it('does not retry permanent adapter failures and keeps logs free of identifiers', async () => {
    const enqueue = vi.fn(async () => { throw new NotificationEnqueueStoreError(false) })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(enqueueNotification({ enqueue }, request)).resolves.toBeUndefined()
      expect(enqueue).toHaveBeenCalledOnce()
      expect(warning).toHaveBeenCalledWith('W05_SOCIAL_NOTIFICATION_WRITE_FAILED', {
        type: 'COMMENT',
        targetType: 'content',
        errorName: 'NotificationEnqueueStoreError',
      })
      expect(JSON.stringify(warning.mock.calls)).not.toContain('recipient-1')
      expect(JSON.stringify(warning.mock.calls)).not.toContain('content-1')
      expect(JSON.stringify(warning.mock.calls)).not.toContain('event-1')
    } finally {
      warning.mockRestore()
    }
  })

  it('does not attempt a store write for self-notifications', async () => {
    const enqueue = vi.fn(async () => undefined)
    await expect(enqueueNotification({ enqueue }, {
      ...request,
      recipientUserId: 'actor-1',
    })).resolves.toBeUndefined()
    expect(enqueue).not.toHaveBeenCalled()
  })
})
