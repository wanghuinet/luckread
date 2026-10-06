import type { AuthStrategyFunction, AuthStrategyResult } from 'payload'

const BRIDGE_HEADER = 'X-LuckRead-Payload-Better-Auth'
const CALLER_HEADER = 'X-LuckRead-Caller'
const CALLER = 'W01'
const AUDIENCE = 'luckread-w01-payload-media'
const VERSION = 1
const TOKEN_TTL_SECONDS = 60
const CLOCK_SKEW_SECONDS = 5
const MAX_TOKEN_LENGTH = 4096

const encoder = new TextEncoder()

export type PayloadBetterAuthBridgeClaims = {
  v: 1
  sub: string
  email: string
  aud: typeof AUDIENCE
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  iat: number
  exp: number
  nonce: string
}

const base64UrlEncode = (value: Uint8Array): string =>
  btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const base64UrlDecode = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const importSecret = async (secret: string, usage: KeyUsage[]): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  )

const sign = async (secret: string, value: string): Promise<string> => {
  const key = await importSecret(secret, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return base64UrlEncode(new Uint8Array(signature))
}

const verifySignature = async (secret: string, value: string, suppliedSignature: string): Promise<boolean> => {
  const key = await importSecret(secret, ['verify'])
  const signature = base64UrlDecode(suppliedSignature)
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(value)),
  )
  if (signature.length !== expected.length) return false

  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= signature[index] ^ expected[index]
  }
  return difference === 0
}

const validMethod = (value: unknown): value is PayloadBetterAuthBridgeClaims['method'] =>
  value === 'GET' || value === 'POST' || value === 'PATCH' || value === 'DELETE'

const validClaims = (
  value: unknown,
  request: Request,
  nowSeconds: number,
): value is PayloadBetterAuthBridgeClaims => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const claims = value as Partial<PayloadBetterAuthBridgeClaims>
  return (
    claims.v === VERSION &&
    typeof claims.sub === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(claims.sub) &&
    typeof claims.email === 'string' &&
    claims.email.length > 0 &&
    claims.email.length <= 320 &&
    claims.aud === AUDIENCE &&
    validMethod(claims.method) &&
    claims.method === request.method &&
    typeof claims.path === 'string' &&
    claims.path === new URL(request.url).pathname &&
    claims.path.length > 0 &&
    claims.path.length <= 2048 &&
    typeof claims.iat === 'number' &&
    Number.isSafeInteger(claims.iat) &&
    claims.iat <= nowSeconds + CLOCK_SKEW_SECONDS &&
    typeof claims.exp === 'number' &&
    Number.isSafeInteger(claims.exp) &&
    claims.exp > nowSeconds &&
    claims.exp - claims.iat > 0 &&
    claims.exp - claims.iat <= TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS &&
    typeof claims.nonce === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/.test(claims.nonce)
  )
}

export const createPayloadBetterAuthBridgeToken = async (
  payloadSecret: string,
  input: Pick<PayloadBetterAuthBridgeClaims, 'sub' | 'email' | 'method' | 'path'>,
  now = new Date(),
): Promise<string> => {
  if (!payloadSecret) throw new Error('Payload secret is unavailable')
  const path = input.path.trim()
  if (!path.startsWith('/') || path.length > 2048) throw new Error('Invalid bridge path')
  if (!validMethod(input.method)) throw new Error('Invalid bridge method')
  const iat = Math.floor(now.getTime() / 1000)
  const claims: PayloadBetterAuthBridgeClaims = {
    v: VERSION,
    sub: input.sub,
    email: input.email.trim().toLowerCase(),
    aud: AUDIENCE,
    method: input.method,
    path,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
    nonce: crypto.randomUUID().replaceAll('-', ''),
  }
  const encodedClaims = base64UrlEncode(encoder.encode(JSON.stringify(claims)))
  return encodedClaims + '.' + await sign(payloadSecret, encodedClaims)
}

export const verifyPayloadBetterAuthBridgeToken = async (
  payloadSecret: string,
  token: string,
  request: Request,
  now = new Date(),
): Promise<PayloadBetterAuthBridgeClaims | null> => {
  if (!payloadSecret || !token || token.length > MAX_TOKEN_LENGTH) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null

  try {
    if (!await verifySignature(payloadSecret, parts[0], parts[1])) return null
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as unknown
    const nowSeconds = Math.floor(now.getTime() / 1000)
    return validClaims(claims, request, nowSeconds) ? claims : null
  } catch {
    return null
  }
}

const authenticatePayloadBetterAuthBridge: AuthStrategyFunction = async ({ headers, payload, req }) => {
    if (headers.get(CALLER_HEADER) !== CALLER || !req) return { user: null }
    const token = headers.get(BRIDGE_HEADER)
    if (!token) return { user: null }

    const claims = await verifyPayloadBetterAuthBridgeToken(payload.secret, token, req)
    if (!claims) return { user: null }

    const user = {
      collection: 'users',
      // Better Auth owns the UUID identity. Payload's generated legacy User
      // type still models its D1-native numeric ID, while Media access stores
      // this value as text and compares it canonically.
      id: claims.sub as unknown as number,
      email: claims.email,
      _strategy: 'luckread-better-auth-bridge',
    } as AuthStrategyResult['user']

    return { user }
}

export const payloadBetterAuthBridgeStrategy = {
  name: 'luckread-better-auth-bridge',
  authenticate: authenticatePayloadBetterAuthBridge,
}

export const PAYLOAD_BETTER_AUTH_BRIDGE_HEADER = BRIDGE_HEADER
export const PAYLOAD_BETTER_AUTH_BRIDGE_CALLER_HEADER = CALLER_HEADER

export const createPayloadBetterAuthBridgeRequest = (
  request: Request,
  targetPath: string,
  token: string,
): Request => {
  const target = new URL(targetPath, request.url)
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set(BRIDGE_HEADER, token)
  headers.set(CALLER_HEADER, CALLER)

  return new Request(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  })
}
