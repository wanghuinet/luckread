import { jwtSign } from 'payload'

// Payload's native auth() must succeed before this non-verifying claim read is used.
export function readVerifiedPayloadTokenVersion(request: Request): number | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
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
