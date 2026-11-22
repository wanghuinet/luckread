import { getApiAuthHeaders, getApiBaseUrl } from './api-client';

type RealtimeOptions = {
  conversationId: string;
  onEvent?: (event: unknown) => void;
  onState?: (state: 'connecting' | 'connected' | 'disconnected' | 'revoked') => void;
};

const activeSockets = new Map<string, WebSocket>();

/** Send ephemeral typing control frames over the existing authenticated socket (no Worker API request). */
export function setMessagingRealtimeTyping(conversationId: string, typing: boolean): boolean {
  const socket = activeSockets.get(conversationId);
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify({ type: typing ? 'typing.start' : 'typing.stop' }));
    return true;
  } catch { return false; }
}

/** Foreground WebSocket with bounded jittered reconnect; no periodic client heartbeat. */
export function connectMessagingRealtime({ conversationId, onEvent, onState }: RealtimeOptions): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let retry = 0;
  const clearReconnect = () => { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; };
  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    onState?.('disconnected');
    const baseDelay = Math.min(30_000, 1_000 * 2 ** Math.min(retry++, 5));
    reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, Math.round(baseDelay * (0.8 + Math.random() * 0.4)));
  };
  const connect = async () => {
    if (stopped || socket) return;
    onState?.('connecting');
    try {
      const headers = await getApiAuthHeaders();
      if (stopped) return;
      const base = getApiBaseUrl().replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
      const url = base + '/v1/conversations/' + encodeURIComponent(conversationId) + '/realtime';
      const NativeWebSocket = WebSocket as unknown as new (url: string, protocols?: string | string[], options?: { headers: Record<string, string> }) => WebSocket;
      const candidate = new NativeWebSocket(url, undefined, { headers });
      socket = candidate;
      candidate.onopen = () => {
        if (stopped || socket !== candidate) return;
        activeSockets.set(conversationId, candidate);
        retry = 0;
        onState?.('connected');
      };
      candidate.onmessage = (message) => {
        if (stopped || socket !== candidate || typeof message.data !== 'string') return;
        try { onEvent?.(JSON.parse(message.data)); } catch { /* Ignore malformed frames. */ }
      };
      candidate.onerror = () => { /* onclose owns the single reconnect path */ };
      candidate.onclose = (event) => {
        if (activeSockets.get(conversationId) === candidate) activeSockets.delete(conversationId);
        if (socket === candidate) socket = null;
        if (event.code === 4003) {
          stopped = true;
          clearReconnect();
          onState?.('revoked');
          return;
        }
        scheduleReconnect();
      };
    } catch { scheduleReconnect(); }
  };
  void connect();
  return () => {
    stopped = true;
    clearReconnect();
    const current = socket;
    socket = null;
    if (current) {
      if (activeSockets.get(conversationId) === current) activeSockets.delete(conversationId);
      current.onopen = null; current.onmessage = null; current.onerror = null; current.onclose = null;
      try { current.close(); } catch { /* already closed */ }
    }
    onState?.('disconnected');
  };
}
