import { callW02 } from '../../../../../auth/w02-session-client.js'

const jsonError = (status: number, code: string, message: string): Response =>
  Response.json(
    { error: { code, message }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S{100,8192}$/i.test(authorization)) {
    return jsonError(401, 'UNAUTHENTICATED', 'GitHub Actions identity token is required')
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > 12_288) {
    return jsonError(413, 'PAYLOAD_TOO_LARGE', 'bootstrap evidence request is too large')
  }

  let body: unknown
  try { body = await request.json() } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'invalid bootstrap evidence request')
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !Number.isSafeInteger((body as { requestPrNumber?: unknown }).requestPrNumber) ||
    Number((body as { requestPrNumber?: unknown }).requestPrNumber) < 1 ||
    typeof (body as { githubToken?: unknown }).githubToken !== 'string' ||
    ((body as { githubToken: string }).githubToken.length < 20) ||
    ((body as { githubToken: string }).githubToken.length > 4096)
  ) {
    return jsonError(400, 'VALIDATION_FAILED', 'invalid bootstrap evidence request')
  }

  // Only the signed GitHub OIDC bearer token is forwarded. Cookies and caller-
  // supplied identity headers are not forwarded to W02.
  const trustedRequest = new Request(request.url, {
    method: 'POST',
    headers: { authorization },
  })

  try {
    const response = await callW02('/internal/authz/bootstrap-super-admin', {
      request: trustedRequest,
      body: {
        requestPrNumber: (body as { requestPrNumber: number }).requestPrNumber,
        githubToken: (body as { githubToken: string }).githubToken,
      },
      headers: {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
      },
    })

    const responseBody = await response.arrayBuffer()
    const headers = new Headers()
    const contentType = response.headers.get('content-type')
    if (contentType) headers.set('content-type', contentType)
    headers.set('cache-control', 'no-store')
    return new Response(responseBody, { status: response.status, headers })
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'W02 bootstrap verification is unavailable')
  }
}
