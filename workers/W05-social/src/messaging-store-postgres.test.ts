import { describe, expect, it, vi } from 'vitest'
import { createPostgresMessagingStore } from './messaging-store-postgres.js'

type Row = Record<string, unknown>
function executor(clientResponses: Array<{ rows: Row[]; rowCount?: number }> = [], directResponses: Array<{ rows: Row[]; rowCount?: number }> = []) {
  const client = {
    query: vi.fn(async (..._args: unknown[]) => clientResponses.shift() ?? { rows: [] }),
    release: vi.fn(),
  }
  const db = {
    query: vi.fn(async (..._args: unknown[]) => directResponses.shift() ?? { rows: [] }),
    connect: vi.fn(async () => client),
  }
  return { db, client }
}

describe('W05 PostgreSQL messaging store', () => {
  it('creates a direct conversation and both memberships in one transaction', async () => {
    const { db, client } = executor([
      { rows: [] }, // BEGIN
      { rows: [] }, // no block
      { rows: [{ mutual: 1 }] }, // mutual follow admission
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [] },
      { rows: [] },
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.createDirectConversation('user-a', 'user-b'))
      .resolves.toEqual({ conversationId: 'conversation-1' })
    expect(client.query.mock.calls[0]?.[0]).toBe('BEGIN')
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('social_conversation_memberships'))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('SET left_at = NULL, archived_at = NULL'))).toBe(true)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rejects a blocked recipient and rolls back without creating a conversation', async () => {
    const { db, client } = executor([{ rows: [] }, { rows: [{ blocked: 1 }] }, { rows: [] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.createDirectConversation('user-a', 'user-b'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_conversations'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('denies new conversations unless both users follow each other', async () => {
    const { db, client } = executor([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.createDirectConversation('user-a', 'user-b'))
      .rejects.toMatchObject({ code: 'CONTACT_POLICY_DENIED', status: 403 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('social_follow_relationships'))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_conversations'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('allocates the message sequence under the conversation lock and persists before returning', async () => {
    const message = {
      message_id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 'user-a',
      sequence: '1', body: 'hello', created_at: '2026-11-21T00:00:00.000Z',
    }
    const { db, client } = executor([
      { rows: [] },
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [{ user_id: 'user-b' }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ last_sequence: '1' }] },
      { rows: [message] },
      { rows: [] },
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
      { rows: [] },
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [{ user_id: 'user-b' }] },
      { rows: [] },
      { rows: [message] },
      { rows: [] },
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.sendMessage('user-a', 'conversation-1', 'client-1', 'hello')).resolves.toEqual(message)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE social_conversations SET last_sequence'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })

  it('rejects sends after a Block and never inserts a message', async () => {
    const { db, client } = executor([
      { rows: [] },
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [{ user_id: 'user-b' }] },
      { rows: [{ blocked: 1 }] },
      { rows: [] },
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.sendMessage('user-a', 'conversation-1', 'client-2', 'hello'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_messages'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('does not return an idempotent retry after a Block is created', async () => {
    const { db, client } = executor([
      { rows: [] },
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [{ user_id: 'user-b' }] },
      { rows: [{ blocked: 1 }] },
      { rows: [] },
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.sendMessage('user-a', 'conversation-1', 'client-1', 'hello'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('client_message_id'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const prior = {
      message_id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 'user-a',
      sequence: '1', body: 'original', created_at: '2026-11-21T00:00:00.000Z',
    }
    const { db, client } = executor([
      { rows: [] },
      { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [{ user_id: 'user-b' }] },
      { rows: [] },
      { rows: [prior] },
      { rows: [] },
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.sendMessage('user-a', 'conversation-1', 'client-1', 'changed'))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_messages'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('paginates message history with a strict before-sequence cursor', async () => {
    const rows = [
      { message_id: 'message-8', conversation_id: 'conversation-1', sender_user_id: 'user-a', sequence: '8', body: 'eight', created_at: '2026-11-21T00:00:08.000Z' },
      { message_id: 'message-7', conversation_id: 'conversation-1', sender_user_id: 'user-b', sequence: '7', body: 'seven', created_at: '2026-11-21T00:00:07.000Z' },
      { message_id: 'message-6', conversation_id: 'conversation-1', sender_user_id: 'user-a', sequence: '6', body: 'six', created_at: '2026-11-21T00:00:06.000Z' },
    ]
    const { db } = executor([], [{ rows: [{ member: 1 }] }, { rows }])
    const store = createPostgresMessagingStore(db as never)
    const page = await store.listMessages('user-a', 'conversation-1', '9', 2)
    expect(page.items.map(item => item.sequence)).toEqual(['8', '7'])
    expect(page).toMatchObject({ nextCursor: '7', hasMore: true })
    expect(db.query.mock.calls[0]?.[0]).toContain('social_user_interactions')
    expect(db.query.mock.calls[1]?.[0]).toContain('sequence < $2::bigint')
    expect(db.query.mock.calls[1]?.[0]).toContain('ORDER BY sequence DESC LIMIT $3')
    expect(db.query.mock.calls[1]?.[1]).toEqual(['conversation-1', '9', 3])
  })

  it('reads only messages after the cursor in ascending sequence order', async () => {
    const rows = [
      { message_id: 'message-11', conversation_id: 'conversation-1', sender_user_id: 'user-b', sequence: '11', body: 'eleven', created_at: '2026-11-21T00:00:11.000Z' },
      { message_id: 'message-12', conversation_id: 'conversation-1', sender_user_id: 'user-a', sequence: '12', body: 'twelve', created_at: '2026-11-21T00:00:12.000Z' },
      { message_id: 'message-13', conversation_id: 'conversation-1', sender_user_id: 'user-b', sequence: '13', body: 'thirteen', created_at: '2026-11-21T00:00:13.000Z' },
    ]
    const { db } = executor([], [{ rows: [{ member: 1 }] }, { rows }])
    const store = createPostgresMessagingStore(db as never)
    const page = await store.listMessagesAfter('user-a', 'conversation-1', '10', 2)
    expect(page.items.map(item => item.sequence)).toEqual(['11', '12'])
    expect(page).toMatchObject({ nextCursor: '12', hasMore: true })
    expect(db.query.mock.calls[0]?.[0]).toContain('social_user_interactions')
    expect(db.query.mock.calls[1]?.[0]).toContain('sequence > $2::bigint')
    expect(db.query.mock.calls[1]?.[0]).toContain('ORDER BY sequence ASC LIMIT $3')
    expect(db.query.mock.calls[1]?.[1]).toEqual(['conversation-1', '10', 3])
  })

  it('denies incremental reads when the actor is not an active member or the peer is blocked', async () => {
    const { db } = executor([], [{ rows: [] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.listMessagesAfter('user-a', 'conversation-1', '0', 30))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(db.query).toHaveBeenCalledOnce()
    expect(String(db.query.mock.calls[0]?.[0])).toContain('social_user_interactions')
  })

  it('hides message history when the actor is not an active conversation member', async () => {
    const { db } = executor([], [{ rows: [] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.listMessages('user-outsider', 'conversation-1', null, 30))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(db.query).toHaveBeenCalledOnce()
  })

  it('edits only a sender-owned active message after membership and block checks', async () => {
    const { db, client } = executor([
      { rows: [] }, // BEGIN
      { rows: [{ allowed: 1 }] }, // active membership, sender ownership, unblocked peer
      { rows: [{ message_id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 'user-a', sequence: '1', body: 'edited', attachments: [], created_at: '2026-11-21T00:00:00.000Z', edited_at: '2026-11-21T00:01:00.000Z', recalled_at: null }] },
      { rows: [] }, // conversation updated_at
      { rows: [] }, // COMMIT
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.editMessage('user-a', 'conversation-1', 'message-1', 'edited'))
      .resolves.toMatchObject({ body: 'edited', edited_at: expect.any(String) })
    expect(String(client.query.mock.calls[1]?.[0])).toContain('message.sender_user_id = mine.user_id')
    expect(String(client.query.mock.calls[1]?.[0])).toContain("blocked.relation_type = 'block'")
    expect(String(client.query.mock.calls[2]?.[0])).toContain('edited_at = CURRENT_TIMESTAMP')
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })

  it('recalls a sender-owned message and clears attachment references atomically', async () => {
    const { db, client } = executor([
      { rows: [] }, // BEGIN
      { rows: [{ allowed: 1 }] }, // authorization
      { rows: [{ message_id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 'user-a', sequence: '1', body: '', attachments: [], created_at: '2026-11-21T00:00:00.000Z', edited_at: null, recalled_at: '2026-11-21T00:01:00.000Z' }] },
      { rows: [] }, // conversation updated_at
      { rows: [] }, // COMMIT
    ])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.recallMessage('user-a', 'conversation-1', 'message-1'))
      .resolves.toMatchObject({ body: '', attachments: [], recalled_at: expect.any(String) })
    expect(String(client.query.mock.calls[2]?.[0])).toContain("attachments = '[]'::jsonb")
    expect(String(client.query.mock.calls[2]?.[0])).toContain('recalled_at = CURRENT_TIMESTAMP')
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })

  it('authorizes attachment reads only for an active unblocked conversation member and referenced media', async () => {
    const { db } = executor([], [{ rows: [{ allowed: 1 }] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.canReadAttachment('user-a', 'conversation-1', 'media-1')).resolves.toBe(true)
    const sql = String(db.query.mock.calls[0]?.[0])
    expect(sql).toContain('social_conversation_memberships')
    expect(sql).toContain('message.attachments @>')
    expect(sql).toContain('message.recalled_at IS NULL')
    expect(sql).toContain('social_user_interactions')
    expect(db.query.mock.calls[0]?.[1]).toEqual(['conversation-1', 'user-a', 'media-1'])
  })

  it('denies attachment reads when the media reference is absent from the conversation', async () => {
    const { db } = executor([], [{ rows: [] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.canReadAttachment('user-outsider', 'conversation-1', 'media-1')).resolves.toBe(false)
  })

  it('filters blocked peers from inbox and calculates incoming unread counts', async () => {
    const { db } = executor([], [{ rows: [] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.listConversations('user-a', null, 30)).resolves.toMatchObject({ items: [], hasMore: false })
    const sql = String(db.query.mock.calls[0]?.[0])
    expect(sql).toContain('social_user_interactions')
    expect(sql).toContain("relation_type = 'block'")
    expect(sql).toContain('unread.sender_user_id <> $1')
    expect(sql).toContain('unread.sequence > mine.last_read_sequence')
  })

  it('rejects malformed conversation cursors before querying the database', async () => {
    const { db } = executor([], [{ rows: [] }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.listConversations('user-a', 'not-a-cursor', 30))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('advances read cursors monotonically and caps them at the conversation sequence', async () => {
    const { db } = executor([], [{ rows: [], rowCount: 1 }])
    const store = createPostgresMessagingStore(db as never)
    await expect(store.markRead('user-a', 'conversation-1', '999')).resolves.toBeUndefined()
    expect(db.query.mock.calls[0]?.[0]).toContain('GREATEST(m.last_read_sequence, LEAST($3::bigint, c.last_sequence))')
    expect(db.query.mock.calls[0]?.[0]).toContain('social_user_interactions')
    expect(db.query.mock.calls[0]?.[0]).toContain("relation_type = 'block'")
  })
})
