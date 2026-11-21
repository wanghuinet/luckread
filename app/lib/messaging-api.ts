import { apiRequest, createIdempotencyKey } from './api-client';

export type MessagingConversation = {
  conversation_id: string; participant_user_id: string; updated_at: string; last_sequence: string;
  last_message_id: string | null; last_message_body: string | null; last_message_sender_user_id: string | null;
  last_message_created_at: string | null; last_read_sequence: string; unread_count: number;
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
export async function fetchConversations(cursor: string | null = null, signal?: AbortSignal): Promise<Page<MessagingConversation>> {
  const query = new URLSearchParams({ limit: '30' });
  if (cursor) query.set('cursor', cursor);
  return unwrap(await apiRequest<Envelope<Page<MessagingConversation>>>('/conversations?' + query.toString(), { method: 'GET', signal }));
}
export async function createDirectConversation(recipientUserId: string): Promise<{ conversationId: string }> {
  return unwrap<{ conversationId: string }>(await apiRequest<Envelope<{ conversationId: string }>>('/conversations', {
    method: 'POST', body: JSON.stringify({ recipientUserId }), idempotencyKey: false,
  }));
}
export async function fetchMessages(conversationId: string, beforeSequence: string | null = null, signal?: AbortSignal): Promise<Page<MessagingMessage>> {
  const query = new URLSearchParams({ limit: '50' });
  if (beforeSequence) query.set('beforeSequence', beforeSequence);
  return unwrap(await apiRequest<Envelope<Page<MessagingMessage>>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/messages?' + query.toString(), { method: 'GET', signal },
  ));
}
export async function fetchMessagesAfter(conversationId: string, afterSequence: string, signal?: AbortSignal): Promise<Page<MessagingMessage>> {
  const query = new URLSearchParams({ afterSequence, limit: '50' });
  return unwrap(await apiRequest<Envelope<Page<MessagingMessage>>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/messages?' + query.toString(), { method: 'GET', signal },
  ));
}
export async function sendDirectMessage(conversationId: string, body: string, idempotencyKey = createIdempotencyKey()): Promise<MessagingMessage> {
  return unwrap<MessagingMessage>(await apiRequest<Envelope<MessagingMessage>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/messages',
    { method: 'POST', body: JSON.stringify({ body }), idempotencyKey },
  ));
}
export async function markConversationRead(conversationId: string, sequence: string) {
  return apiRequest('/conversations/' + encodeURIComponent(conversationId) + '/read', {
    method: 'POST', body: JSON.stringify({ sequence }), idempotencyKey: false,
  });
}

export type MessageRequest = {
  request_id: string; sender_user_id: string; recipient_user_id: string; initial_message: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'; conversation_id: string | null;
  created_at: string; responded_at: string | null;
};
export async function fetchMessageRequests(direction: 'incoming' | 'outgoing', cursor: string | null = null, signal?: AbortSignal): Promise<Page<MessageRequest>> {
  const query = new URLSearchParams({ direction, limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return unwrap(await apiRequest<Envelope<Page<MessageRequest>>>('/message-requests?' + query.toString(), { method: 'GET', signal }));
}
export async function createMessageRequest(recipientUserId: string, body: string, idempotencyKey = createIdempotencyKey()): Promise<MessageRequest> {
  return unwrap(await apiRequest<Envelope<MessageRequest>>('/message-requests', {
    method: 'POST', body: JSON.stringify({ recipientUserId, body }), idempotencyKey,
  }));
}
export async function respondToMessageRequest(requestId: string, action: 'accept' | 'decline' | 'cancel'): Promise<{ status: MessageRequest['status']; conversationId: string | null }> {
  return unwrap(await apiRequest<Envelope<{ status: MessageRequest['status']; conversationId: string | null }>>(
    '/message-requests/' + encodeURIComponent(requestId) + '/' + action, { method: 'POST', body: JSON.stringify({}), idempotencyKey: false },
  ));
}
