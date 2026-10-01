import { jwtSign } from 'payload'

const getCookieValue = (request: Request, name: string): string | null => {
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) return null

  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 0) continue

    const key = segment.slice(0, separator).trim()
    if (key !== name) continue

    const value = segment.slice(separator + 1).trim()
    if (!value) return null

    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  return null
}

export function readPayloadAccessToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? ''
  if (authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim()
    if (token) return token
  }

  return getCookieValue(request, 'payload-token')
}

export function getPayloadAuthorizationHeader(request: Request): string | null {
  const token = readPayloadAccessToken(request)
  return token ? 'Bearer ' + token : null
}

// Payload's native auth() must succeed before this non-verifying claim read is used.
export function readVerifiedPayloadTokenVersion(request: Request): number | null {
  const token = readPayloadAccessToken(request)
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = atob(padded)
    const claims = JSON.parse(json) as { tokenVersion?: unknown }
    return typeof claims.tokenVersion === 'number' &&
      Number.isSafeInteger(claims.tokenVersion) &&
      claims.tokenVersion >= 0
      ? claims.tokenVersion
      : null
  } catch {
    return null
  }
}

export function buildPayloadAccessCookie(token: string, maxAgeSeconds: number, request: Request): string {
  const maxAge = Math.max(1, Math.floor(maxAgeSeconds))
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `payload-token=${encodeURIComponent(token)}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`
}

export function buildPayloadClearCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `payload-token=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`
}

export async function issuePayloadAccessToken(input: {
  payloadSecret: string
  userId: string
  email: string
  sessionId: string
  expiresAt: string
  tokenVersion: number
  now?: string
}): Promise<{ token: string; exp: number; expiresIn: number }> {
  if (!input.payloadSecret) throw new Error('Payload secret is required')
  if (!input.userId || !input.email || !input.sessionId) {
    throw new Error('Payload access-token subject is incomplete')
  }
  if (!Number.isInteger(input.tokenVersion) || input.tokenVersion < 0) {
    throw new Error('Payload access-token tokenVersion is invalid')
  }

  const nowSeconds = Math.floor(Date.parse(input.now ?? new Date().toISOString()) / 1000)
  const exp = Math.floor(Date.parse(input.expiresAt) / 1000)

  if (!Number.isFinite(nowSeconds) || !Number.isFinite(exp) || exp <= nowSeconds) {
    throw new Error('Payload session expiry is invalid')
  }

  const result = await jwtSign({
    fieldsToSign: {
      id: input.userId,
      collection: 'users',
      email: input.email,
      sid: input.sessionId,
      tokenVersion: input.tokenVersion,
    },
    secret: input.payloadSecret,
    tokenExpiration: Math.max(1, exp - nowSeconds),
  })

  return {
    token: result.token,
    exp: result.exp,
    expiresIn: Math.max(0, result.exp - nowSeconds),
  }
}
