import { getApiAuthHeaders, getApiBaseUrl } from './api-client';

type RealtimeOptions = {
  conversationId: string;
  onEvent?: (event: unknown) => void;
  onState?: (state: 'connecting' | 'connected' | 'disconnected') => void;
};

/** Native WebSocket with bearer auth and bounded reconnect; lifecycle is owned by caller. */
export function connectMessagingRealtime({ conversationId, onEvent, onState }: RealtimeOptions): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let retry = 0;

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    reconnectTimer = null;
    pingTimer = null;
  };
  const closeSocket = () => {
    clearTimers();
    const current = socket;
    socket = null;
    if (current) {
      current.onopen = null; current.onmessage = null; current.onerror = null; current.onclose = null;
      try { current.close(); } catch {}
    }
  };
  const connect = async () => {
    if (stopped) return;
    onState?.('connecting');
    try {
      const headers = await getApiAuthHeaders();
      if (stopped) return;
      const base = getApiBaseUrl().replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
      const url = base + '/v1/conversations/' + encodeURIComponent(conversationId) + '/realtime';
      // React Native's WebSocket implementation accepts custom headers in its third argument.
      const candidate = new WebSocket(url, undefined, { headers } as never);
      socket = candidate;
      candidate.onopen = () => {
        if (stopped || socket !== candidate) return;
        retry = 0;
        onState?.('connected');
        pingTimer = setInterval(() => {
          if (candidate.readyState === WebSocket.OPEN) candidate.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      };
      candidate.onmessage = (message) => {
        if (stopped || socket !== candidate || typeof message.data !== 'string') return;
        try { onEvent?.(JSON.parse(message.data)); } catch { /* malformed frame */ }
      };
      candidate.onerror = () => { /* close drives reconnect */ };
      candidate.onclose = () => {
        if (socket === candidate) socket = null;
        clearTimers();
        if (stopped) return;
        onState?.('disconnected');
        const delay = Math.min(30_000, 1_000 * Math.pow(2, Math.min(retry++, 5)));
        reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, delay);
      };
    } catch {
      if (stopped) return;
      onState?.('disconnected');
      const delay = Math.min(30_000, 1_000 * Math.pow(2, Math.min(retry++, 5)));
      reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, delay);
    }
  };
  void connect();
  return () => { stopped = true; closeSocket(); onState?.('disconnected'); };
}
