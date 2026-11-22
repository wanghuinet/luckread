/// <reference types="@cloudflare/workers-types" />

/** Conversation-scoped realtime hub. Formal message data remains authoritative in Neon. */
type TypingState = Record<string, number>;
type SocketAttachment = { userId: string };
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TYPING_TTL_MS = 5_000;
const MAX_FRAME_BYTES = 1_024;

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
      this.broadcast(event);
      return Response.json({ broadcast: true });
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
      const input = body as { userId?: unknown; typing?: unknown };
      if (typeof input.userId !== 'string' || !USER_ID.test(input.userId) || typeof input.typing !== 'boolean') return new Response('Invalid payload', { status: 422 });
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
    if (!USER_ID.test(userId)) return new Response('Unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ userId } satisfies SocketAttachment);
    this.state.acceptWebSocket(server, [`user:${userId}`]);
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
    if (!userId || !USER_ID.test(userId)) return;
    const state = await this.readTypingState();
    if (frame.type === 'typing.start') state[userId] = Date.now() + TYPING_TTL_MS;
    else delete state[userId];
    await this.writeTypingState(state);
    this.broadcast({ type: 'typing.changed', occurredAt: Date.now(), payload: { activeUserIds: Object.keys(state) } });
  }
  webSocketClose(_socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {}
  webSocketError(_socket: WebSocket, _error: unknown): void {}

  private broadcast(event: unknown): void {
    const payload = JSON.stringify(event);
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(payload); }
      catch { try { socket.close(1011, 'Realtime delivery failed'); } catch { /* already closed */ } }
    }
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
    const state = await this.readTypingState();
    if (Object.keys(state).length) this.broadcast({ type: 'typing.changed', occurredAt: Date.now(), payload: { activeUserIds: Object.keys(state) } });
  }
}
