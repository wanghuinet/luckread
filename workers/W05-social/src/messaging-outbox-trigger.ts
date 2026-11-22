/** Recognize durable messaging mutations; skip reads, typing and websocket connects. */
export function isMessagingMutationRequest(request: Request): boolean {
  const path = new URL(request.url).pathname
  if (path === '/internal/messaging/conversations/groups' || path === '/internal/messaging/conversations' || path === '/internal/messaging/requests') return request.method === 'POST'
  if (/^\/internal\/messaging\/requests\/[^/]+\/(accept|decline|cancel)$/.test(path)) return request.method === 'POST'
  if (/^\/internal\/messaging\/conversations\/[^/]+\/members(?:\/[^/]+)?$/.test(path)) return ['POST','DELETE'].includes(request.method)
  if (/^\/internal\/messaging\/conversations\/[^/]+\/(transfer-owner|leave|read)$/.test(path)) return request.method === 'POST'
  if (/^\/internal\/messaging\/conversations\/[^/]+\/messages$/.test(path)) return request.method === 'POST'
  if (/^\/internal\/messaging\/conversations\/[^/]+\/messages\/[^/]+$/.test(path)) return ['PATCH','DELETE'].includes(request.method)
  return false
}
