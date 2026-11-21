import { MessageRequestStoreError, type MessageRequestStore } from './message-request-store.js'
export class MessageRequestRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'MessageRequestRuntimeError' }
}
const id = (value: string) => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) throw new MessageRequestRuntimeError('VALIDATION_FAILED', 422)
  return normalized
}
const call = <T>(fn: () => Promise<T>) => fn().catch(error => {
  if (error instanceof MessageRequestStoreError) throw new MessageRequestRuntimeError(error.code, error.status)
  throw error
})
function pageLimit(value: string | null): number {
  if (value === null) return 20
  if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 50) throw new MessageRequestRuntimeError('VALIDATION_FAILED', 422)
  return Number(value)
}
export async function createMessageRequest(store: MessageRequestStore | undefined, actor: string, recipient: string, key: string, body: unknown) {
  if (!store) throw new MessageRequestRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (typeof body !== 'string') throw new MessageRequestRuntimeError('VALIDATION_FAILED', 422)
  const text = body.normalize('NFC').trim()
  if (!text || text.length > 1000) throw new MessageRequestRuntimeError('VALIDATION_FAILED', 422)
  return call(() => store.createRequest(id(actor), id(recipient), id(key), text))
}
export async function listMessageRequests(store: MessageRequestStore | undefined, actor: string, direction: string | null, cursor: string | null, limit: string | null) {
  if (!store) throw new MessageRequestRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (direction !== 'incoming' && direction !== 'outgoing') throw new MessageRequestRuntimeError('VALIDATION_FAILED', 422)
  return call(() => store.listRequests(id(actor), direction, cursor, pageLimit(limit)))
}
export async function respondToMessageRequest(store: MessageRequestStore | undefined, actor: string, requestId: string, action: string) {
  if (!store) throw new MessageRequestRuntimeError('SERVICE_UNAVAILABLE', 503)
  if (action !== 'accept' && action !== 'decline' && action !== 'cancel') throw new MessageRequestRuntimeError('VALIDATION_FAILED', 422)
  return call(() => store.respondRequest(id(actor), id(requestId), action))
}
