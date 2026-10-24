import {
  callFactor,
  enforceMfaEdgeLimit,
  enforceMfaEndpointLimit,
  isRecord,
  mfaError,
  onlyKeys,
} from '../../shared.js'

type PublicUser = {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  image: string | null
}

const publicUser = (value: unknown): PublicUser | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.email !== 'string' ||
      typeof value.emailVerified !== 'boolean') return null
  return {
    id: value.id,
    email: value.email,
    name: typeof value.name === 'string' ? value.name : null,
    emailVerified: value.emailVerified,
    image: typeof value.image === 'string' ? value.image : null,
  }
}

export async function POST(request: Request): Promise<Response> {
  const edgeError = await enforceMfaEdgeLimit(request)
  if (edgeError) return edgeError
  const endpointError = await enforceMfaEndpointLimit(request, 'authMfaChallengeVerify')
  if (endpointError) return endpointError

  let body: unknown
  try { body = await request.json() } catch {
    return mfaError(422, 'VALIDATION_FAILED', 'Invalid MFA challenge request')
  }
  if (!isRecord(body) || !onlyKeys(body, ['code', 'method']) ||
      typeof body.code !== 'string' || typeof body.method !== 'string') {
    return mfaError(422, 'VALIDATION_FAILED', 'MFA code and method are required')
  }

  let upstream
  if (body.method === 'totp' && /^\d{6}$/.test(body.code)) {
    const result = await callFactor(request, '/two-factor/verify-totp', {
      code: body.code,
      trustDevice: false,
    })
    if ('response' in result) return result.response
    upstream = result
  } else if (
    body.method === 'recovery_code' &&
    body.code.length >= 1 &&
    body.code.length <= 128 &&
    /^[\x21-\x7E]+$/.test(body.code)
  ) {
    const result = await callFactor(request, '/two-factor/verify-backup-code', {
      code: body.code,
      disableSession: false,
      trustDevice: false,
    })
    if ('response' in result) return result.response
    upstream = result
  } else {
    return mfaError(422, 'VALIDATION_FAILED', 'MFA code format or method is invalid')
  }

  let payload: unknown
  try { payload = await upstream.json() } catch {
    return mfaError(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'MFA verification response is invalid')
  }
  const user = isRecord(payload) ? publicUser(payload.user) : null
  const sessionToken = upstream.headers.get('set-auth-token')?.trim() ?? ''
  if (!user || !sessionToken || sessionToken.length > 8192) {
    return mfaError(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'MFA verification response is invalid')
  }

  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'X-LuckRead-Session-Token': sessionToken,
  })
  const sourceHeaders = upstream.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = sourceHeaders.getSetCookie?.() ?? []
  if (setCookies.length > 0) {
    for (const cookie of setCookies) headers.append('set-cookie', cookie)
  } else {
    const cookie = upstream.headers.get('set-cookie')
    if (cookie) headers.append('set-cookie', cookie)
  }

  // Do not forward Better Auth's raw body, session JSON token, or factor data.
  return new Response(JSON.stringify({
    data: { authenticated: true, user },
    requestId: 'req_' + crypto.randomUUID(),
  }), { status: 200, headers })
}
