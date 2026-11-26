import { apiRequest, createIdempotencyKey, getApiBaseUrl } from './api-client';
import { uploadMediaFile, type LocalMediaFile } from './publish-api';

export type MessagingConversation = {
  conversation_id: string; conversation_type: 'direct' | 'group'; group_name: string | null; member_count: number; participant_user_id: string | null; updated_at: string; last_sequence: string;
  last_message_id: string | null; last_message_body: string | null; last_message_sender_user_id: string | null;
  last_message_created_at: string | null; last_read_sequence: string; unread_count: number;
};
export type MessagingAttachment = {
  mediaId: string; filename: string; mimeType: string; filesize: number; width: number | null; height: number | null;
};
export type MessagingMessage = {
  message_id: string; conversation_id: string; sender_user_id: string; sequence: string; body: string;
  attachments?: MessagingAttachment[]; created_at: string; edited_at?: string | null; recalled_at?: string | null;
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
export type MessagingConversationMember = {
  user_id: string; member_role: 'owner' | 'member'; joined_at: string; last_read_sequence: string;
};
export async function createGroupConversation(name: string, memberUserIds: string[]): Promise<{ conversationId: string }> {
  return unwrap(await apiRequest<Envelope<{ conversationId: string }>>('/conversations/groups', {
    method: 'POST', body: JSON.stringify({ name, memberUserIds }),
  }));
}
export async function fetchConversationMembers(conversationId: string, signal?: AbortSignal): Promise<MessagingConversationMember[]> {
  return unwrap(await apiRequest<Envelope<MessagingConversationMember[]>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/members', { method: 'GET', signal },
  ));
}
export async function addGroupMembers(conversationId: string, memberUserIds: string[]): Promise<{ addedCount: number }> {
  return unwrap(await apiRequest<Envelope<{ addedCount: number }>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/members',
    { method: 'POST', body: JSON.stringify({ memberUserIds }) },
  ));
}
export async function removeGroupMember(conversationId: string, memberUserId: string): Promise<void> {
  const result = await apiRequest('/conversations/' + encodeURIComponent(conversationId) + '/members/' + encodeURIComponent(memberUserId), {
    method: 'DELETE',
  });
  if (!result.response.ok) throw new Error(result.error?.message || '无法移除群聊成员。');
}
export async function transferGroupOwnership(conversationId: string, targetUserId: string): Promise<void> {
  const result = await apiRequest('/conversations/' + encodeURIComponent(conversationId) + '/transfer-owner', {
    method: 'POST', body: JSON.stringify({ targetUserId }), idempotencyKey: false,
  });
  if (!result.response.ok) throw new Error(result.error?.message || '无法转移群聊所有权。');
}
export async function leaveGroupConversation(conversationId: string): Promise<void> {
  const result = await apiRequest('/conversations/' + encodeURIComponent(conversationId) + '/leave', {
    method: 'POST', body: JSON.stringify({ }), idempotencyKey: false,
  });
  if (!result.response.ok) throw new Error(result.error?.message || '无法退出群聊。');
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

/** Drain bounded incremental-sync pages in one cycle to avoid silently stranding message gaps. */
export async function fetchMessagesAfterBatch(
  conversationId: string,
  afterSequence: string,
  signal?: AbortSignal,
  maxPages = 10,
): Promise<Page<MessagingMessage>> {
  const itemsById = new Map<string, MessagingMessage>();
  let cursor = afterSequence;
  let hasMore = false;
  const pageBudget = Math.max(1, Math.min(10, Math.floor(maxPages)));
  for (let pageIndex = 0; pageIndex < pageBudget; pageIndex++) {
    const page = await fetchMessagesAfter(conversationId, cursor, signal);
    if (!page.items.length) {
      if (page.hasMore) throw new Error('私信增量同步游标未推进，请重试。');
      hasMore = false;
      break;
    }
    let nextCursor = cursor;
    for (const item of page.items) {
      if (compareMessagingSequence(item.sequence, cursor) <= 0) continue;
      if (compareMessagingSequence(item.sequence, nextCursor) > 0) nextCursor = item.sequence;
      itemsById.set(item.message_id, item);
    }
    if (compareMessagingSequence(nextCursor, cursor) <= 0) {
      throw new Error('私信增量同步游标未推进，请重试。');
    }
    cursor = nextCursor;
    hasMore = page.hasMore;
    if (!hasMore) break;
  }
  return { items: [...itemsById.values()].sort((left, right) =>
    compareMessagingSequence(left.sequence, right.sequence)), nextCursor: hasMore ? cursor : null, hasMore };
}

function compareMessagingSequence(left: string, right: string): number {
  return left.length === right.length ? left.localeCompare(right) : left.length - right.length;
}
export async function uploadMessageAttachment(file: LocalMediaFile, idempotencyKey = createIdempotencyKey(), expectedAccountId?: string) {
  if (typeof file.size === 'number' && (!Number.isFinite(file.size) || file.size <= 0 || file.size > 20 * 1024 * 1024)) throw new Error('附件不能超过 20 MB，且文件大小必须有效。');
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  if (!allowed.includes(file.mimeType.toLowerCase())) throw new Error('仅支持 JPG、PNG、WebP、GIF 和 PDF。');
  const media = await uploadMediaFile(file, idempotencyKey, undefined, expectedAccountId);
  return {
    mediaId: media.id,
    filename: media.filename,
    mimeType: media.mimeType.toLowerCase(),
    filesize: media.filesize ?? (typeof file.size === 'number' ? file.size : 0),
    width: file.width ?? null,
    height: file.height ?? null,
  } satisfies MessagingAttachment;
}
export async function sendDirectMessage(
  conversationId: string,
  body: string,
  idempotencyKey = createIdempotencyKey(),
  attachments: MessagingAttachment[] = [],
  expectedAccountId?: string,
): Promise<MessagingMessage> {
  return unwrap<MessagingMessage>(await apiRequest<Envelope<MessagingMessage>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/messages',
    { method: 'POST', body: JSON.stringify({ body, attachments }), idempotencyKey, expectedAccountId },
  ));
}
export async function editDirectMessage(conversationId: string, messageId: string, body: string): Promise<MessagingMessage> {
  return unwrap<MessagingMessage>(await apiRequest<Envelope<MessagingMessage>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/messages/' + encodeURIComponent(messageId),
    { method: 'PATCH', body: JSON.stringify({ body }) },
  ));
}
export async function recallDirectMessage(conversationId: string, messageId: string): Promise<MessagingMessage> {
  return unwrap<MessagingMessage>(await apiRequest<Envelope<MessagingMessage>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/messages/' + encodeURIComponent(messageId),
    { method: 'DELETE' },
  ));
}
export function getMessageAttachmentUrl(conversationId: string, mediaId: string): string {
  return getApiBaseUrl() + '/v1/conversations/' + encodeURIComponent(conversationId) +
    '/attachments/' + encodeURIComponent(mediaId);
}

export async function markConversationRead(conversationId: string, sequence: string) {
  const result = await apiRequest('/conversations/' + encodeURIComponent(conversationId) + '/read', {
    method: 'POST', body: JSON.stringify({ sequence }), idempotencyKey: false,
  });
  if (!result.response.ok) {
    throw new Error(result.error?.message || 'Could not update message read status.');
  }
  return result;
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

export type MessagingTypingSnapshot = { activeUserIds: string[] }
export async function setConversationTyping(conversationId: string, typing: boolean): Promise<MessagingTypingSnapshot> {
  return unwrap(await apiRequest<Envelope<MessagingTypingSnapshot>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/typing',
    { method: 'POST', body: JSON.stringify({ typing }), idempotencyKey: false },
  ))
}
export async function fetchConversationTyping(conversationId: string, signal?: AbortSignal): Promise<MessagingTypingSnapshot> {
  return unwrap(await apiRequest<Envelope<MessagingTypingSnapshot>>(
    '/conversations/' + encodeURIComponent(conversationId) + '/typing', { method: 'GET', signal },
  ))
}
