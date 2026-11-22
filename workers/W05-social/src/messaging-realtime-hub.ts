/// <reference types="@cloudflare/workers-types" />

/** Conversation-scoped realtime hub. Formal message data remains authoritative in Neon. */
type TypingState = Record<string, number>;
type SocketAttachment = { userId: string; membershipVersion: number };
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TYPING_TTL_MS = 5_000;
const MAX_FRAME_BYTES = 1_024;
const EVENT_DEDUPE_KEY = 'messaging-event-dedupe';
const EVENT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1_000;
const EVENT_DEDUPE_MAX = 2_048;

export class MessagingRealtimeHub {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith('/connect')) return this.connect(request);
    if (pathname.endsWith('/broadcast')) {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const actor = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? '';
      if (!USER_ID.test(actor)) return new Response('Unauthorized', { status: 401 });
      let event: unknown;
      try { event = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      if (!event || typeof event !== 'object' || Array.isArray(event)) return new Response('Invalid event', { status: 422 });
      const input = event as Record<string, unknown>;
      const allowedTypes = new Set([
        'message.created', 'message.edited', 'message.recalled', 'conversation.read',
        'group.member.added', 'group.member.removed', 'group.member.left', 'group.owner.transferred',
      ]);
      if (typeof input.type !== 'string' || !allowedTypes.has(input.type) ||
        typeof input.conversationId !== 'string' || !USER_ID.test(input.conversationId) ||
        input.actorUserId !== actor || typeof input.eventId !== 'string' ||
        !USER_ID.test(input.eventId) || typeof input.occurredAt !== 'number' ||
        !Number.isFinite(input.occurredAt) || !input.payload || typeof input.payload !== 'object' ||
        Array.isArray(input.payload)) return new Response('Invalid event', { status: 422 });
      const encoded = JSON.stringify(input);
      if (encoded.length > 64 * 1024) return new Response('Event too large', { status: 413 });

      // Outbox delivery is at-least-once. Keep a bounded, durable receipt set so an
      // immediate delivery and a later scheduled retry share one idempotency fence.
      const now = Date.now();
      // Reserve the event ID atomically before side effects. Concurrent retry requests
      // must not both pass the receipt check while revoke/broadcast awaits yield.
      const reserved = await this.state.storage.transaction(async transaction => {
        const receipts = (await transaction.get<Record<string, number>>(EVENT_DEDUPE_KEY)) ?? {};
        for (const [eventId, expiresAt] of Object.entries(receipts)) {
          if (!Number.isFinite(expiresAt) || expiresAt <= now) delete receipts[eventId];
        }
        if (Object.prototype.hasOwnProperty.call(receipts, input.eventId as string)) return false;
        receipts[input.eventId as string] = now + EVENT_DEDUPE_TTL_MS;
        const entries = Object.entries(receipts).sort((left, right) => left[1] - right[1]).slice(-EVENT_DEDUPE_MAX);
        await transaction.put(EVENT_DEDUPE_KEY, Object.fromEntries(entries));
        return true;
      });
      if (!reserved) return Response.json({ broadcast: false, duplicate: true });

      try {
        // Membership mutations revoke the removed member's existing room socket, not just future API access.
        if (input.type === 'group.member.removed') {
          const payload = input.payload as { memberUserId?: unknown; membershipVersion?: unknown };
          if (typeof payload.memberUserId !== 'string' || !USER_ID.test(payload.memberUserId) ||
            !Number.isSafeInteger(payload.membershipVersion) || (payload.membershipVersion as number) < 1) {
            // Release the reservation for malformed payloads; validation must not poison the event ID.
            await this.releaseEventReceipt(input.eventId as string);
            return new Response('Invalid event payload', { status: 422 });
          }
          await this.revokeUser(payload.memberUserId, payload.membershipVersion as number);
        } else if (input.type === 'group.member.left') {
          const payload = input.payload as { membershipVersion?: unknown };
          if (!Number.isSafeInteger(payload.membershipVersion) || (payload.membershipVersion as number) < 1) {
            await this.releaseEventReceipt(input.eventId as string);
            return new Response('Invalid event payload', { status: 422 });
          }
          await this.revokeUser(actor, payload.membershipVersion as number);
        }
        const failedSockets = this.broadcast(encoded);
        if (failedSockets > 0) throw new Error(`Realtime broadcast failed for ${failedSockets} socket(s)`);
        return Response.json({ broadcast: true });
      } catch (error) {
        // Failed side effects must not permanently suppress the Outbox retry.
        await this.releaseEventReceipt(input.eventId as string);
        return new Response('Realtime delivery failed', { status: 503 });
      }
    }
    if (pathname.endsWith('/snapshot')) {
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
      return Response.json({ activeUserIds: await this.activeTypingUsers() }, { headers: { 'cache-control': 'no-store' } });
    }
    if (pathname.endsWith('/update')) {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      let body: unknown;
      try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response('Invalid payload', { status: 400 });
      const actor = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? '';
      const rawMembershipVersion = request.headers.get('X-LuckRead-Membership-Version')?.trim() ?? '';
      if (!USER_ID.test(actor) || !/^[1-9][0-9]{0,17}$/.test(rawMembershipVersion)) return new Response('Unauthorized', { status: 401 });
      const membershipVersion = Number(rawMembershipVersion);
      if (!Number.isSafeInteger(membershipVersion)) return new Response('Invalid membership version', { status: 422 });
      const input = body as { userId?: unknown; typing?: unknown };
      if (input.userId !== actor || typeof input.typing !== 'boolean') return new Response('Invalid payload', { status: 422 });
      if (!(await this.isMembershipActive(actor, membershipVersion))) return new Response('Conversation membership revoked', { status: 403 });
      const state = await this.readTypingState();
      if (input.typing) state[input.userId] = Date.now() + TYPING_TTL_MS;
      else delete state[input.userId];
      await this.writeTypingState(state);
      const activeUserIds = Object.keys(state);
      this.broadcast({ type: 'typing.changed', occurredAt: Date.now(), payload: { activeUserIds } });
      return Response.json({ activeUserIds }, { headers: { 'cache-control': 'no-store' } });
    }
    return new Response('Not Found', { status: 404 });
  }

  private async connect(request: Request): Promise<Response> {
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    const userId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? '';
    const rawMembershipVersion = request.headers.get('X-LuckRead-Membership-Version')?.trim() ?? '';
    if (!USER_ID.test(userId) || !/^[1-9][0-9]{0,17}$/.test(rawMembershipVersion)) {
      return new Response('Unauthorized', { status: 401 });
    }
    const membershipVersion = Number(rawMembershipVersion);
    if (!Number.isSafeInteger(membershipVersion)) return new Response('Invalid membership version', { status: 422 });
    const revocationKey = `membership-revoked:${userId}`;
    const revokedVersion = await this.state.storage.get<number>(revocationKey);
    if (!this.isMembershipVersionActive(membershipVersion, revokedVersion)) {
      return new Response('Conversation membership revoked', { status: 403 });
    }
    // Keep the highest revoked version as a durable fence even after rejoin.
    // Clearing it here could let an older socket become active again if close() failed.
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ userId, membershipVersion } satisfies SocketAttachment);
    this.state.acceptWebSocket(server, [`user:${userId}`]);
    // Recheck after accept: a revoke event may have been delivered while the initial storage read yielded.
    const latestRevokedVersion = await this.state.storage.get<number>(revocationKey);
    if (!this.isMembershipVersionActive(membershipVersion, latestRevokedVersion)) {
      try { server.close(4003, 'Conversation membership revoked'); } catch { /* closed during handshake */ }
      return new Response('Conversation membership revoked', { status: 403 });
    }
    server.send(JSON.stringify({ type: 'connected', occurredAt: Date.now() }));
    server.send(JSON.stringify({ type: 'typing.changed', occurredAt: Date.now(), payload: { activeUserIds: await this.activeTypingUsers() } }));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Hibernation API event handlers: no per-socket listener closures or isolate-local socket Map. */
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_FRAME_BYTES) return;
    let frame: { type?: unknown };
    try { frame = JSON.parse(message) as { type?: unknown }; } catch { return; }
    if (frame.type === 'ping') {
      try { socket.send(JSON.stringify({ type: 'pong', at: Date.now() })); } catch { /* closed */ }
      return;
    }
    if (frame.type !== 'typing.start' && frame.type !== 'typing.stop') return;
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const userId = attachment?.userId;
    const membershipVersion = attachment?.membershipVersion;
    if (!userId || !USER_ID.test(userId) || typeof membershipVersion !== 'number' || !Number.isSafeInteger(membershipVersion)) return;
    if (!(await this.isMembershipActive(userId, membershipVersion))) {
      try { socket.close(4003, 'Conversation membership revoked'); } catch { /* already closed */ }
      return;
    }
    const state = await this.readTypingState();
    if (frame.type === 'typing.start') state[userId] = Date.now() + TYPING_TTL_MS;
    else delete state[userId];
    await this.writeTypingState(state);
    this.broadcast({ type: 'typing.changed', occurredAt: Date.now(), payload: { activeUserIds: Object.keys(state) } });
  }
  webSocketClose(_socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {}
  webSocketError(_socket: WebSocket, _error: unknown): void {}

  private isMembershipVersionActive(membershipVersion: number, revokedVersion: number | undefined): boolean {
    return Number.isSafeInteger(membershipVersion) && membershipVersion > 0 &&
      (!Number.isSafeInteger(revokedVersion) || membershipVersion > (revokedVersion as number));
  }

  private async isMembershipActive(userId: string, membershipVersion: number): Promise<boolean> {
    const revokedVersion = await this.state.storage.get<number>(`membership-revoked:${userId}`);
    return this.isMembershipVersionActive(membershipVersion, revokedVersion);
  }

  private async revokeUser(userId: string, membershipVersion: number): Promise<void> {
    const revocationKey = `membership-revoked:${userId}`;
    const previousVersion = await this.state.storage.get<number>(revocationKey);
    const effectiveVersion = Number.isSafeInteger(previousVersion)
      ? Math.max(previousVersion as number, membershipVersion)
      : membershipVersion;
    await this.state.storage.put(revocationKey, effectiveVersion);

    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.userId !== userId || attachment.membershipVersion > membershipVersion) continue;
      try { socket.close(4003, 'Conversation membership revoked'); } catch { /* already closed */ }
    }
    const hasNewerSocket = this.state.getWebSockets().some((socket) => {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      return attachment?.userId === userId && attachment.membershipVersion > membershipVersion;
    });
    if (!hasNewerSocket) {
      const state = await this.readTypingState();
      if (Object.prototype.hasOwnProperty.call(state, userId)) {
        delete state[userId];
        await this.writeTypingState(state);
      }
    }
  }

  private broadcast(event: unknown): number {
    const payload = typeof event === 'string' ? event : JSON.stringify(event);
    let failures = 0;
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(payload); }
      catch { failures++; try { socket.close(1011, 'Realtime delivery failed'); } catch { /* already closed */ } }
    }
    return failures;
  }

  private async releaseEventReceipt(eventId: string): Promise<void> {
    await this.state.storage.transaction(async transaction => {
      const receipts = (await transaction.get<Record<string, number>>(EVENT_DEDUPE_KEY)) ?? {};
      delete receipts[eventId];
      await transaction.put(EVENT_DEDUPE_KEY, receipts);
    });
  }

  private async readTypingState(): Promise<TypingState> {
    const state = await this.state.storage.get<TypingState>('typing') ?? {};
    const now = Date.now();
    let changed = false;
    for (const [userId, expiresAt] of Object.entries(state)) {
      if (!Number.isFinite(expiresAt) || expiresAt <= now) { delete state[userId]; changed = true; }
    }
    if (changed) await this.writeTypingState(state);
    return state;
  }
  private async activeTypingUsers(): Promise<string[]> { return Object.keys(await this.readTypingState()); }
  private async writeTypingState(state: TypingState): Promise<void> {
    if (Object.keys(state).length) {
      await this.state.storage.put('typing', state);
      await this.state.storage.setAlarm(Math.min(...Object.values(state)));
    } else {
      await this.state.storage.delete('typing');
      await this.state.storage.deleteAlarm();
    }
  }
  async alarm(): Promise<void> {
    const previous = await this.state.storage.get<TypingState>('typing') ?? {};
    const expired = Object.values(previous).some((expiresAt) => !Number.isFinite(expiresAt) || expiresAt <= Date.now());
    const state = await this.readTypingState();
    if (expired) {
      this.broadcast({ type: 'typing.changed', occurredAt: Date.now(), payload: { activeUserIds: Object.keys(state) } });
    }
  }
}
