import { describe, expect, it, vi } from 'vitest'
import { createPostgresMessagingStore } from './messaging-store-postgres.js'

type Row = Record<string, unknown>
function executor(clientResponses: Array<{ rows: Row[]; rowCount?: number }> = [], directResponses: Array<{ rows: Row[]; rowCount?: number }> = []) {
  const client = {
    query: vi.fn(async () => clientResponses.shift() ?? { rows: [] }),
    release: vi.fn(),
  }
  const db = {
    query: vi.fn(async () => directResponses.shift() ?? { rows: [] }),
    connect: vi.fn(async () => client),
  }
  return { db, client }
}

describe('W05 PostgreSQL messaging store', () => {
  it('creates a direct conversation and both memberships in one transaction', async () => {
    const { db, client } = executor([
      { rows: [] },
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [] },
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.createDirectConversation('user-a', 'user-b'))
      .resolves.toEqual({ conversationId: 'conversation-1' })
    expect(client.query.mock.calls[0]?.[0]).toBe('BEGIN')
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('social_conversation_memberships'))).toBe(true)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rejects a blocked recipient and rolls back without creating a conversation', async () => {
    const { db, client } = executor([{ rows: [{ blocked: 1 }] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.createDirectConversation('user-a', 'user-b'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_conversations'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('allocates the message sequence under the conversation lock and persists before returning', async () => {
    const message = {
      message_id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 'user-a',
      sequence: '1', body: 'hello', created_at: '2026-11-21T00:00:00.000Z',
    }
    const { db, client } = executor([
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [] },
      { rows: [{ user_id: 'user-b' }] },
      { rows: [] },
      { rows: [{ last_sequence: '1' }] },
      { rows: [message] },
      { rows: [] },
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.sendMessage('user-a', 'conversation-1', 'client-1', 'hello')).resolves.toEqual(message)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FOR UPDATE OF c'))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE social_conversations SET last_sequence'))).toBe(true)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })

  it('returns the prior message for a same-key same-payload retry', async () => {
    const message = {
      message_id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 'user-a',
      sequence: '1', body: 'hello', created_at: '2026-11-21T00:00:00.000Z',
    }
    const { db, client } = executor([
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [message] },
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.sendMessage('user-a', 'conversation-1', 'client-1', 'hello')).resolves.toEqual(message)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE social_conversations SET last_sequence'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })

  it('advances read cursors monotonically and caps them at the conversation sequence', async () => {
    const { db } = executor([], [{ rows: [], rowCount: 1 }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.markRead('user-a', 'conversation-1', '999')).resolves.toBeUndefined()
    expect(db.query.mock.calls[0]?.[0]).toContain('GREATEST(m.last_read_sequence, LEAST($3::bigint, c.last_sequence))')
  })
})
