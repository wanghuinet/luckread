import { describe, expect, it, vi } from 'vitest'
import { createDirectConversation, listConversations, listMessages, markConversationRead, sendMessage } from './messaging-runtime.js'
import type { MessagingStore } from './messaging-store.js'

const store = (): MessagingStore => ({
  createDirectConversation: vi.fn(async () => ({ conversationId: 'conversation-1' })),
  listConversations: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
  listMessages: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
  listMessagesAfter: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
  sendMessage: vi.fn(async () => ({
    message_id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 'user-1',
    sequence: '1', body: 'hello', created_at: '2026-11-21T00:00:00.000Z',
  })),
  markRead: vi.fn(async () => undefined),
})

describe('messaging runtime', () => {
  it('creates a direct conversation for two distinct canonical identities', async () => {
    const source = store()
    await expect(createDirectConversation(source, 'user-1', 'user-2')).resolves.toEqual({ conversationId: 'conversation-1' })
    expect(source.createDirectConversation).toHaveBeenCalledWith('user-1', 'user-2')
  })
  it('rejects self-conversations', async () => {
    await expect(createDirectConversation(store(), 'user-1', 'user-1')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })
  })
  it('uses bounded cursor pages', async () => {
    const source = store()
    await expect(listConversations(source, 'user-1', null, '30')).resolves.toMatchObject({ hasMore: false })
    await expect(listMessages(source, 'user-1', 'conversation-1', null, '50')).resolves.toMatchObject({ hasMore: false })
    await expect(listConversations(source, 'user-1', null, '51')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
  it('validates and forwards an after-sequence incremental cursor', async () => {
    const source = store()
    await expect(listMessagesAfter(source, 'user-1', 'conversation-1', '12', '50')).resolves.toMatchObject({ hasMore: false })
    expect(source.listMessagesAfter).toHaveBeenCalledWith('user-1', 'conversation-1', '12', 50)
    await expect(listMessagesAfter(source, 'user-1', 'conversation-1', null, '50')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })
    await expect(listMessagesAfter(source, 'user-1', 'conversation-1', '-1', '50')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })
  })
  it('requires a stable idempotency key and valid text for send', async () => {
    const source = store()
    await expect(sendMessage(source, 'user-1', 'conversation-1', 'client-key-1', ' hello ')).resolves.toMatchObject({ sequence: '1' })
    expect(source.sendMessage).toHaveBeenCalledWith('user-1', 'conversation-1', 'client-key-1', 'hello')
    await expect(sendMessage(source, 'user-1', 'conversation-1', '', 'hello')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
  it('advances read state through the store contract', async () => {
    const source = store()
    await expect(markConversationRead(source, 'user-1', 'conversation-1', '12')).resolves.toBeUndefined()
    expect(source.markRead).toHaveBeenCalledWith('user-1', 'conversation-1', '12')
  })
})
