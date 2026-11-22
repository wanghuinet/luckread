import { describe, expect, it, vi } from 'vitest'
import { MessagingRealtimeHub } from './messaging-realtime-hub.js'

function makeSocket(userId: string, membershipVersion = 1) {
  const lifecycle = { closed: false }
  return {
    deserializeAttachment: () => ({ userId, membershipVersion }),
    isClosed: () => lifecycle.closed,
    close: vi.fn(() => { lifecycle.closed = true }),
    send: vi.fn(),
  } as unknown as WebSocket & { close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; isClosed: () => boolean }
}

function makeState(sockets: WebSocket[], typing: Record<string, number> = {}, revokedVersions: Record<string, number> = {}) {
  const values = new Map<string, unknown>()
  if (Object.keys(typing).length) values.set('typing', { ...typing })
  for (const [userId, version] of Object.entries(revokedVersions)) values.set(`membership-revoked:${userId}`, version)
  const storage = {
    get: vi.fn(async (key: string) => values.get(key)),
    put: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
    delete: vi.fn(async (key: string) => { values.delete(key) }),
    setAlarm: vi.fn(async () => undefined),
    deleteAlarm: vi.fn(async () => undefined),
    transaction: vi.fn(async (run: (transaction: any) => Promise<unknown>) => run(storage)),
  }
  return {
    state: { getWebSockets: () => sockets.filter(socket => !(socket as WebSocket & { isClosed?: () => boolean }).isClosed?.()), storage } as unknown as DurableObjectState,
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
        payload: { memberUserId: 'removed-user', membershipVersion: 2 },
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
        payload: { memberUserId: 'leaving-user', membershipVersion: 2 },
      }),
    }))
    expect(valid.status).toBe(200)
    expect(leaving.close).toHaveBeenCalledWith(4003, 'Conversation membership revoked')
    expect(leaving.send).not.toHaveBeenCalled()
  })

  it('does not revoke a rejoined socket when an older removal event arrives late', async () => {
    const oldSession = makeSocket('same-user', 1)
    const rejoinedSession = makeSocket('same-user', 3)
    const { state, storage } = makeState([oldSession, rejoinedSession], {
      'same-user': Date.now() + 5_000,
    })
    const hub = new MessagingRealtimeHub(state)
    const response = await hub.fetch(new Request('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'X-LuckRead-Principal-User-Id': 'owner-user', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'group.member.removed',
        conversationId: 'conversation-1',
        actorUserId: 'owner-user',
        eventId: 'event-rejoin-fence',
        occurredAt: Date.now(),
        payload: { memberUserId: 'same-user', membershipVersion: 2 },
      }),
    }))

    expect(response.status).toBe(200)
    expect(oldSession.close).toHaveBeenCalledWith(4003, 'Conversation membership revoked')
    expect(rejoinedSession.close).not.toHaveBeenCalled()
    expect(rejoinedSession.send).toHaveBeenCalledOnce()
    expect(storage.put).toHaveBeenCalledWith('membership-revoked:same-user', 2)
    expect(storage.put).not.toHaveBeenCalledWith('typing', {})
  })

  it('keeps stale websocket sessions fenced after a member rejoins at a newer version', async () => {
    const staleSocket = makeSocket('member-user', 1);
    const { state, storage } = makeState([staleSocket], {}, { 'member-user': 2 });
    const hub = new MessagingRealtimeHub(state);

    await hub.webSocketMessage(staleSocket, JSON.stringify({ type: 'typing.start' }));

    expect(staleSocket.close).toHaveBeenCalledWith(4003, 'Conversation membership revoked');
    expect(storage.put).not.toHaveBeenCalledWith('typing', expect.anything());
    expect(storage.get).toHaveBeenCalledWith('membership-revoked:member-user');
  });

  it('uses the persisted revocation high-water mark when an older removal event arrives late', async () => {
    const staleSession = makeSocket('same-user', 3);
    const currentSession = makeSocket('same-user', 5);
    const { state, storage } = makeState([staleSession, currentSession], {}, { 'same-user': 4 });
    const hub = new MessagingRealtimeHub(state);
    const response = await hub.fetch(new Request('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'X-LuckRead-Principal-User-Id': 'owner-user', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'group.member.removed',
        conversationId: 'conversation-1',
        actorUserId: 'owner-user',
        eventId: 'event-old-revocation',
        occurredAt: Date.now(),
        payload: { memberUserId: 'same-user', membershipVersion: 2 },
      }),
    }));

    expect(response.status).toBe(200);
    expect(staleSession.close).toHaveBeenCalledWith(4003, 'Conversation membership revoked');
    expect(staleSession.send).not.toHaveBeenCalled();
    expect(currentSession.close).not.toHaveBeenCalled();
    expect(currentSession.send).toHaveBeenCalledOnce();
    expect(storage.put).toHaveBeenCalledWith('membership-revoked:same-user', 4);
    expect(storage.transaction).toHaveBeenCalled();
  });

  it('rejects typing writes from a stale membership version', async () => {
    const { state, storage } = makeState([], {}, { 'member-user': 2 })
    const hub = new MessagingRealtimeHub(state)
    const response = await hub.fetch(new Request('https://messaging-hub.internal/update', {
      method: 'POST',
      headers: {
        'X-LuckRead-Principal-User-Id': 'member-user',
        'X-LuckRead-Membership-Version': '2',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'member-user', typing: true }),
    }))
    expect(response.status).toBe(403)
    expect(storage.put).not.toHaveBeenCalledWith('typing', expect.anything())
  })

  it('delivers a repeated outbox event only once across direct and scheduled attempts', async () => {
    const member = makeSocket('member-user');
    const { state, storage } = makeState([member]);
    const hub = new MessagingRealtimeHub(state);
    const request = () => new Request('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'X-LuckRead-Principal-User-Id': 'sender-user', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'message.created',
        conversationId: 'conversation-1',
        actorUserId: 'sender-user',
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        occurredAt: Date.now(),
        payload: { message_id: 'message-1' },
      }),
    });

    const first = await hub.fetch(request());
    const retry = await hub.fetch(request());

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ broadcast: true });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ broadcast: false, duplicate: true });
    expect(member.send).toHaveBeenCalledOnce();
    expect(storage.put).toHaveBeenCalledWith('messaging-event-dedupe', {
      '123e4567-e89b-12d3-a456-426614174000': expect.any(Number),
    });
    expect(storage.transaction).toHaveBeenCalledTimes(2);
  });

  it('expires old event receipts and keeps the dedupe set bounded', async () => {
    const member = makeSocket('member-user');
    const oldReceipts = Object.fromEntries(
      Array.from({ length: 2_050 }, (_, index) => ['old-' + index, Date.now() - 1]),
    );
    const { state, storage } = makeState([member]);
    storage.get.mockImplementation(async (key: string) =>
      key === 'messaging-event-dedupe' ? oldReceipts : undefined,
    );
    const hub = new MessagingRealtimeHub(state);
    const response = await hub.fetch(new Request('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'X-LuckRead-Principal-User-Id': 'sender-user', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'message.created',
        conversationId: 'conversation-1',
        actorUserId: 'sender-user',
        eventId: '123e4567-e89b-12d3-a456-426614174001',
        occurredAt: Date.now(),
        payload: { message_id: 'message-2' },
      }),
    }));
    expect(response.status).toBe(200);
    const stored = storage.put.mock.calls.find(([key]) => key === 'messaging-event-dedupe')?.[1] as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(1);
    expect(stored['123e4567-e89b-12d3-a456-426614174001']).toBeGreaterThan(Date.now());
  });

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
