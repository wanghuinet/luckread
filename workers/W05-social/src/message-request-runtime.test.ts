import { describe, expect, it, vi } from 'vitest'
import { createMessageRequest, listMessageRequests, respondToMessageRequest } from './message-request-runtime.js'
import type { MessageRequestStore } from './message-request-store.js'

const store = (): MessageRequestStore => ({
  createRequest: vi.fn(async () => ({
    request_id: 'request-1', sender_user_id: 'user-a', recipient_user_id: 'user-b',
    initial_message: 'Hello', status: 'pending', conversation_id: null,
    created_at: '2026-11-21T00:00:00.000Z', responded_at: null,
  })),
  listRequests: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
  respondRequest: vi.fn(async () => ({ status: 'accepted' as const, conversationId: 'conversation-1' })),
})

describe('message request runtime', () => {
  it('normalizes and bounds the first-contact message', async () => {
    const source = store()
    await expect(createMessageRequest(source, 'user-a', 'user-b', 'request-key-1', ' Hello ')).resolves.toMatchObject({ status: 'pending' })
    expect(source.createRequest).toHaveBeenCalledWith('user-a', 'user-b', 'request-key-1', 'Hello')
    await expect(createMessageRequest(source, 'user-a', 'user-b', 'request-key-1', ' ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(createMessageRequest(source, 'user-a', 'user-b', 'request-key-1', 'x'.repeat(1001))).rejects.toMatchObject({ status: 422 })
  })
  it('requires an incoming or outgoing request folder and bounds pagination', async () => {
    const source = store()
    await expect(listMessageRequests(source, 'user-a', 'incoming', null, '20')).resolves.toMatchObject({ hasMore: false })
    expect(source.listRequests).toHaveBeenCalledWith('user-a', 'incoming', null, 20)
    await expect(listMessageRequests(source, 'user-a', 'all', null, '20')).rejects.toMatchObject({ status: 422 })
    await expect(listMessageRequests(source, 'user-a', 'outgoing', null, '51')).rejects.toMatchObject({ status: 422 })
  })
  it('limits request decisions to accept, decline, and cancel', async () => {
    const source = store()
    await expect(respondToMessageRequest(source, 'user-b', 'request-1', 'accept')).resolves.toEqual({ status: 'accepted', conversationId: 'conversation-1' })
    expect(source.respondRequest).toHaveBeenCalledWith('user-b', 'request-1', 'accept')
    await expect(respondToMessageRequest(source, 'user-b', 'request-1', 'delete')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
