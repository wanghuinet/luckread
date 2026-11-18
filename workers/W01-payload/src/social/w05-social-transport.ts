import type { ContentPrincipal } from '../content/w03-content-client.js'
import { relayW05Response } from './w05-response.js'

export type W05SocialService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export type W05SocialCallInput = Readonly<{
  request: Request
  pathname: string
  method: string
  principal: ContentPrincipal
  body?: unknown
}>

export type W05SocialServiceProvider = () => Promise<W05SocialService>

/**
 * Production W01-to-W05 transport. Only the platform Service Binding lookup is
 * injected; request authentication headers, body serialization, and response
 * relay remain shared by production and integration tests.
 */
export function createW05SocialCaller(getService: W05SocialServiceProvider) {
  return async function callW05Social(input: W05SocialCallInput): Promise<Response> {
    const service = await getService()
    const headers = new Headers({
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id':
        input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
      'X-LuckRead-Principal-User-Id': input.principal.userId,
    })
    if (input.principal.layer) headers.set('X-LuckRead-Principal-Layer', input.principal.layer)
    headers.set('X-LuckRead-Principal-Verified', input.principal.verified === true ? 'true' : 'false')
    if (input.body !== undefined) headers.set('content-type', 'application/json; charset=utf-8')
    const idempotencyKey = input.request.headers.get('Idempotency-Key')?.trim()
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)
    const ifMatch = input.request.headers.get('If-Match')?.trim()
    if (ifMatch) headers.set('If-Match', ifMatch)

    const response = await service.fetch(
      new Request('https://luckread-w05.internal' + input.pathname, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      }),
    )

    const responseHeaders = new Headers({
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    const etag = response.headers.get('etag')
    if (etag) responseHeaders.set('etag', etag)
    const contentId = response.headers.get('X-LuckRead-Content-Id')
    if (contentId) responseHeaders.set('X-LuckRead-Content-Id', contentId)
    return relayW05Response(response, responseHeaders)
  }
}

export type W05SocialPublicCallInput = Readonly<{
  request: Request
  pathname: string
  method: string
  principal?: ContentPrincipal | null
  body?: unknown
}>

/** Public-read transport supports anonymous projections but never caches viewer-specific responses. */
export function createW05SocialPublicCaller(getService: W05SocialServiceProvider) {
  return async function callW05SocialPublic(input: W05SocialPublicCallInput): Promise<Response> {
    const service = await getService()
    const headers = new Headers({
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id':
        input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
    })
    if (input.principal?.userId) {
      headers.set('X-LuckRead-Principal-User-Id', input.principal.userId)
      headers.set('X-LuckRead-Rate-Key', 'user:' + input.principal.userId)
    } else {
      const clientIp = input.request.headers.get('cf-connecting-ip')?.trim()
      if (clientIp) {
        headers.set('X-LuckRead-Client-IP', clientIp)
        headers.set('X-LuckRead-Rate-Key', 'ip:' + clientIp)
      }
    }
    if (input.body !== undefined) headers.set('content-type', 'application/json; charset=utf-8')
    const response = await service.fetch(
      new Request('https://luckread-w05.internal' + input.pathname, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      }),
    )
    const responseHeaders = new Headers({
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    const etag = response.headers.get('etag')
    if (etag) responseHeaders.set('etag', etag)
    return relayW05Response(response, responseHeaders)
  }
}
