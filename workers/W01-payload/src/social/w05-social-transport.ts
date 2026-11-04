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
