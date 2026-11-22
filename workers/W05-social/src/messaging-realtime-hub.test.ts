import { describe, expect, it, vi } from 'vitest'
import { MessagingRealtimeHub } from './messaging-realtime-hub.js'

function makeSocket(userId: string) {
  return {
    deserializeAttachment: () => ({ userId }),
    close: vi.fn(),
    send: vi.fn(),
  } as unknown as WebSocket & { close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }
}

function makeState(sockets: WebSocket[], typing: Record<string, number> = {}) {
  const storage = {
    get: vi.fn(async (key: string) => key === 'typing' ? { ...typing } : undefined),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    setAlarm: vi.fn(async () => undefined),
    deleteAlarm: vi.fn(async () => undefined),
  }
  return {
    state: { getWebSockets: () => sockets, storage } as unknown as DurableObjectState,
    storage,
  }
}

describe('MessagingRealtimeHub membership revocation', () => {
  it('closes the removed member socket, clears their typing state, and broadcasts only to remaining members', async () => {
    const removed = makeSocket('removed-user')
    const remaining = makeSocket('remaining-user')
    const { state, storage } = makeState([removed, remaining], {
      'removed-user': Date.now() + 5_000,
      'remaining-user': Date.now() + 5_000,
    })
    const hub = new MessagingRealtimeHub(state)
    const response = await hub.fetch(new Request('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'X-LuckRead-Principal-User-Id': 'owner-user', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'group.member.removed',
        conversationId: 'conversation-1',
        actorUserId: 'owner-user',
        eventId: 'event-1',
        occurredAt: Date.now(),
        payload: { memberUserId: 'removed-user' },
      }),
    }))

    expect(response.status).toBe(200)
    expect(removed.close).toHaveBeenCalledWith(4003, 'Conversation membership revoked')
    expect(removed.send).not.toHaveBeenCalled()
    expect(remaining.close).not.toHaveBeenCalled()
    expect(remaining.send).toHaveBeenCalledOnce()
    expect(String(remaining.send.mock.calls[0]?.[0])).toContain('group.member.removed')
    expect(storage.put).toHaveBeenCalledWith('typing', { 'remaining-user': expect.any(Number) })
  })

  it('closes the leaving member socket and rejects an event whose actor differs from the trusted principal', async () => {
    const leaving = makeSocket('leaving-user')
    const { state } = makeState([leaving])
    const hub = new MessagingRealtimeHub(state)
    const invalid = await hub.fetch(new Request('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'X-LuckRead-Principal-User-Id': 'trusted-user', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'group.member.left',
        conversationId: 'conversation-1',
        actorUserId: 'spoofed-user',
        eventId: 'event-2',
        occurredAt: Date.now(),
        payload: { memberUserId: 'spoofed-user' },
      }),
    }))
    expect(invalid.status).toBe(422)
    expect(leaving.close).not.toHaveBeenCalled()

    const valid = await hub.fetch(new Request('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'X-LuckRead-Principal-User-Id': 'leaving-user', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'group.member.left',
        conversationId: 'conversation-1',
        actorUserId: 'leaving-user',
        eventId: 'event-3',
        occurredAt: Date.now(),
        payload: { memberUserId: 'leaving-user' },
      }),
    }))
    expect(valid.status).toBe(200)
    expect(leaving.close).toHaveBeenCalledWith(4003, 'Conversation membership revoked')
    expect(leaving.send).not.toHaveBeenCalled()
  })

  it('rejects oversized or unsupported events before broadcasting', async () => {
    const member = makeSocket('member-user')
    const { state } = makeState([member])
    const hub = new MessagingRealtimeHub(state)
    const response = await hub.fetch(new Request('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'X-LuckRead-Principal-User-Id': 'owner-user', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'unknown.event',
        conversationId: 'conversation-1',
        actorUserId: 'owner-user',
        eventId: 'event-4',
        occurredAt: Date.now(),
        payload: {},
      }),
    }))
    expect(response.status).toBe(422)
    expect(member.send).not.toHaveBeenCalled()
  })
})
