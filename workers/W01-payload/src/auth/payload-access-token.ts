const textEncoder = new TextEncoder()

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function encodeJson(value: unknown): string {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)))
}

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

  const header = encodeJson({ alg: 'HS256', typ: 'JWT' })
  const claims = encodeJson({
    id: input.userId,
    collection: 'users',
    email: input.email,
    sid: input.sessionId,
    tokenVersion: input.tokenVersion,
    iat: nowSeconds,
    exp,
  })

  const signingInput = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(input.payloadSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingInput)),
  )

  return {
    token: `${signingInput}.${bytesToBase64Url(signature)}`,
    exp,
    expiresIn: Math.max(0, exp - nowSeconds),
  }
}
