import { MessagingStoreError, type MessagingAttachment, type MessagingStore } from './messaging-store.js'
export class MessagingRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'MessagingRuntimeError' }
}
const MAX_LIMIT = 50
const MAX_ATTACHMENTS = 4
function requireId(value: string, code = 'VALIDATION_FAILED'): string {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) throw new MessagingRuntimeError(code, code === 'UNAUTHENTICATED' ? 401 : 422)
  return normalized
}
function limit(value: string | null): number {
  if (value === null) return 30
  if (!/^[1-9][0-9]{0,2}$/.test(value)) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  const parsed = Number(value)
  if (parsed > MAX_LIMIT) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  return parsed
}
function storeCall<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch(error => {
    if (error instanceof MessagingStoreError) throw new MessagingRuntimeError(error.code, error.status)
    throw error
  })
}
function normalizeAttachments(value: unknown): MessagingAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  const seen = new Set<string>()
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
    const item = raw as Record<string, unknown>
    const mediaId = typeof item.mediaId === 'string' ? item.mediaId.trim() : ''
    const filename = typeof item.filename === 'string' ? item.filename.trim() : ''
    const mimeType = typeof item.mimeType === 'string' ? item.mimeType.toLowerCase().trim() : ''
    const filesize = item.filesize
    const width = item.width === null ? null : item.width
    const height = item.height === null ? null : item.height
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(mediaId) || seen.has(mediaId) ||
      !filename || filename.length > 255 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(mimeType) ||
      typeof filesize !== 'number' || !Number.isSafeInteger(filesize) || filesize < 1 || filesize > 20 * 1024 * 1024 ||
      (width !== null && (typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1 || width > 100000)) ||
      (height !== null && (typeof height !== 'number' || !Number.isSafeInteger(height) || height < 1 || height > 100000))) {
      throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
    }
    seen.add(mediaId)
    return { mediaId, filename, mimeType, filesize, width: width as number | null, height: height as number | null }
  })
}
export async function createGroupConversation(store: MessagingStore | undefined, actorValue: string, nameValue: unknown, memberValues: unknown) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (typeof nameValue !== 'string' || !Array.isArray(memberValues) ||
    memberValues.length < 2 || memberValues.length > 49 ||
    memberValues.some(value => typeof value !== 'string')) {
    throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  }
  const name = nameValue.normalize('NFC').trim()
  if (!name || name.length > 80) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  const actor = requireId(actorValue, 'UNAUTHENTICATED')
  const members = memberValues.map(value => requireId(value as string))
  return storeCall(() => store.createGroupConversation(actor, members, name))
}
export async function listConversationMembers(store: MessagingStore | undefined, actorValue: string, conversationId: string) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  return storeCall(() => store.listConversationMembers(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId)))
}
export async function addGroupMembers(store: MessagingStore | undefined, actorValue: string, conversationId: string, memberValues: unknown) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (!Array.isArray(memberValues) || memberValues.length < 1 || memberValues.length > 49 ||
    memberValues.some(value => typeof value !== 'string')) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  const actor = requireId(actorValue, 'UNAUTHENTICATED')
  const members = memberValues.map(value => requireId(value as string))
  return storeCall(() => store.addGroupMembers(actor, requireId(conversationId), members))
}
export async function removeGroupMember(store: MessagingStore | undefined, actorValue: string, conversationId: string, memberUserId: string) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  return storeCall(() => store.removeGroupMember(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId), requireId(memberUserId)))
}
export async function transferGroupOwnership(store: MessagingStore | undefined, actorValue: string, conversationId: string, targetValue: string) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  const actor = requireId(actorValue, 'UNAUTHENTICATED')
  const target = requireId(targetValue)
  if (actor === target) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  return storeCall(() => store.transferGroupOwnership(actor, requireId(conversationId), target))
}
export async function leaveGroupConversation(store: MessagingStore | undefined, actorValue: string, conversationId: string) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  return storeCall(() => store.leaveGroupConversation(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId)))
}
export async function createDirectConversation(store: MessagingStore | undefined, actorValue: string, recipientValue: string) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  const actor = requireId(actorValue, 'UNAUTHENTICATED')
  const recipient = requireId(recipientValue)
  if (actor === recipient) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  return storeCall(() => store.createDirectConversation(actor, recipient))
}
export async function listConversations(store: MessagingStore | undefined, actorValue: string, cursor: string | null, rawLimit: string | null) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  return storeCall(() => store.listConversations(requireId(actorValue, 'UNAUTHENTICATED'), cursor, limit(rawLimit)))
}
export async function listMessages(store: MessagingStore | undefined, actorValue: string, conversationId: string, beforeSequence: string | null, rawLimit: string | null) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  return storeCall(() => store.listMessages(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId), beforeSequence, limit(rawLimit)))
}
export async function listMessagesAfter(store: MessagingStore | undefined, actorValue: string, conversationId: string, afterSequence: string | null, rawLimit: string | null) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (afterSequence === null || !/^(0|[1-9][0-9]{0,17})$/.test(afterSequence)) {
    throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  }
  return storeCall(() => store.listMessagesAfter(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId), afterSequence, limit(rawLimit)))
}
export async function sendMessage(store: MessagingStore | undefined, actorValue: string, conversationId: string, idempotencyKey: string, bodyValue: unknown, attachmentsValue?: unknown) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  const actor = requireId(actorValue, 'UNAUTHENTICATED')
  const conversation = requireId(conversationId)
  const key = requireId(idempotencyKey)
  if (typeof bodyValue !== 'string') throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  const body = bodyValue.normalize('NFC').trim()
  const attachments = normalizeAttachments(attachmentsValue)
  if (body.length > 10000 || (!body && !attachments.length)) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  return storeCall(() => store.sendMessage(actor, conversation, key, body, attachments))
}
export async function editMessage(store: MessagingStore | undefined, actorValue: string, conversationId: string, messageId: string, bodyValue: unknown) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (typeof bodyValue !== 'string') throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  const body = bodyValue.normalize('NFC').trim()
  if (!body || body.length > 10000) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  return storeCall(() => store.editMessage(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId), requireId(messageId), body))
}
export async function recallMessage(store: MessagingStore | undefined, actorValue: string, conversationId: string, messageId: string) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  return storeCall(() => store.recallMessage(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId), requireId(messageId)))
}
export async function markConversationRead(store: MessagingStore | undefined, actorValue: string, conversationId: string, sequenceValue: unknown) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  const sequence = typeof sequenceValue === 'string' ? sequenceValue : typeof sequenceValue === 'number' && Number.isSafeInteger(sequenceValue) ? String(sequenceValue) : ''
  if (!sequence) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  return storeCall(() => store.markRead(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId), sequence))
}
