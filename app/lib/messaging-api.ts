import { apiRequest, createIdempotencyKey } from './api-client';

export type MessagingConversation = {
  conversation_id: string; participant_user_id: string; updated_at: string; last_sequence: string;
  last_message_id: string | null; last_message_body: string | null; last_message_sender_user_id: string | null;
  last_message_created_at: string | null; last_read_sequence: string;
};
export type MessagingMessage = {
  message_id: string; conversation_id: string; sender_user_id: string; sequence: string; body: string; created_at: string;
};
type Page<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };
type Envelope<T> = { data?: T; error?: { code?: string; message?: string }; requestId?: string };
type ApiEnvelopeResult = { response: Response; data: unknown; error: { message: string } | null };

function unwrap<T>(result: ApiEnvelopeResult): T {
  const envelope = result.data as Envelope<T> | null;
  if (!result.response.ok || !envelope || typeof envelope !== 'object' || !('data' in envelope)) {
    throw new Error(result.error?.message || envelope?.error?.message || 'Messaging request failed.');
  }
  return envelope.data as T;
}
export async function fetchConversations(signal?: AbortSignal): Promise<Page<MessagingConversation>> {
  return unwrap(await apiRequest<Envelope<Page<MessagingConversation>>>('/conversations?limit=30', { method: 'GET', signal }));
}
export async function createDirectConversation(recipientUserId: string) {
  return unwrap(await apiRequest<Envelope<{ conversationId: string }>>('/conversations', {
    method: 'POST', body: JSON.stringify({ recipientUserId }), idempotencyKey: false,
  }));
}
export async function fetchMessages(conversationId: string, signal?: AbortSignal): Promise<Page<MessagingMessage>> {
  return unwrap(await apiRequest<Envelope<Page<MessagingMessage>>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/messages?limit=50', { method: 'GET', signal },
  ));
}
export async function sendDirectMessage(conversationId: string, body: string, idempotencyKey = createIdempotencyKey()) {
  return unwrap(await apiRequest<Envelope<MessagingMessage>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/messages',
    { method: 'POST', body: JSON.stringify({ body }), idempotencyKey },
  ));
}
export async function markConversationRead(conversationId: string, sequence: string) {
  return apiRequest('/conversations/' + encodeURIComponent(conversationId) + '/read', {
    method: 'POST', body: JSON.stringify({ sequence }), idempotencyKey: false,
  });
}
