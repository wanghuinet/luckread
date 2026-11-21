import { MessagingStoreError, type MessagingStore } from './messaging-store.js'
export class MessagingRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'MessagingRuntimeError' }
}
const MAX_LIMIT = 50
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
export async function sendMessage(store: MessagingStore | undefined, actorValue: string, conversationId: string, idempotencyKey: string, bodyValue: unknown) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  const actor = requireId(actorValue, 'UNAUTHENTICATED')
  const conversation = requireId(conversationId)
  const key = requireId(idempotencyKey)
  if (typeof bodyValue !== 'string') throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  const body = bodyValue.normalize('NFC').trim()
  if (!body || body.length > 10000) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  return storeCall(() => store.sendMessage(actor, conversation, key, body))
}
export async function markConversationRead(store: MessagingStore | undefined, actorValue: string, conversationId: string, sequenceValue: unknown) {
  if (!store) throw new MessagingRuntimeError('SERVICE_UNAVAILABLE', 503)
  const sequence = typeof sequenceValue === 'string' ? sequenceValue : typeof sequenceValue === 'number' && Number.isSafeInteger(sequenceValue) ? String(sequenceValue) : ''
  if (!sequence) throw new MessagingRuntimeError('VALIDATION_FAILED', 422)
  return storeCall(() => store.markRead(requireId(actorValue, 'UNAUTHENTICATED'), requireId(conversationId), sequence))
}
