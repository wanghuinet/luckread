import { getCloudflareContext } from '@opennextjs/cloudflare'
import { betterAuth } from 'better-auth'
import { hashPassword as betterAuthHashPassword, verifyPassword as betterAuthVerifyPassword } from 'better-auth/crypto'
import { bearer } from 'better-auth/plugins/bearer'

type BetterAuthEnv = {
  D1: D1Database
  BETTER_AUTH_SECRET?: string
  PAYLOAD_SECRET?: string
}

type BetterAuthInstance = ReturnType<typeof betterAuth>

const authCache = new WeakMap<object, BetterAuthInstance>()

const textEncoder = new TextEncoder()

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

async function derivePbkdf2(password: string, saltHex: string, iterations: number, keyLength: number): Promise<string> {
  const salt = hexToBytes(saltHex)
  if (!salt) throw new Error('invalid password salt')
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    key,
    keyLength * 8,
  )
  return bytesToHex(new Uint8Array(bits))
}

async function hashPassword(password: string): Promise<string> {
  return betterAuthHashPassword(password)
}

async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  const current = /^pbkdf2-sha256-v1:([0-9a-f]{64}):([0-9a-f]{64})$/i.exec(input.hash)
  if (current) {
    try {
      const expected = hexToBytes(current[2])
      if (!expected) return false
      for (const iterations of [100_000, 600_000]) {
        try {
          const derived = await derivePbkdf2(input.password, current[1], iterations, 32)
          const actual = hexToBytes(derived)
          if (actual !== null && constantTimeEqual(expected, actual)) return true
        } catch {
          // Try the alternate admitted Payload hash cost before failing closed.
        }
      }
      return false
    } catch {
      return false
    }
  }

  const legacy = /^pbkdf2-sha256-legacy:([0-9a-f]{64}):([0-9a-f]{1024})$/i.exec(input.hash)
  if (legacy) {
    try {
      const derived = await derivePbkdf2(input.password, legacy[1], 25_000, 512)
      const expected = hexToBytes(legacy[2])
      const actual = hexToBytes(derived)
      return expected !== null && actual !== null && constantTimeEqual(expected, actual)
    } catch {
      return false
    }
  }

  try {
    return await betterAuthVerifyPassword(input)
  } catch {
    return false
  }
}

function makeAuth(env: BetterAuthEnv): BetterAuthInstance {
  const secret = env.BETTER_AUTH_SECRET ?? env.PAYLOAD_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required')

  return betterAuth({
    secret,
    basePath: '/api/auth',
    database: env.D1,
    user: {
      modelName: 'users',
      fields: {
        name: 'username',
        email: 'email',
        emailVerified: 'email_verified',
        image: 'avatar',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        displayName: {
          type: 'string',
          required: false,
          fieldName: 'display_name',
        },
        accountState: {
          type: 'string',
          required: false,
          input: false,
          returned: true,
          defaultValue: 'PENDING_VERIFICATION',
          fieldName: 'account_state',
        },
        accountStateVersion: {
          type: 'number',
          required: false,
          input: false,
          returned: true,
          fieldName: 'account_state_version',
        },
      },
    },
    session: {
      modelName: 'auth_sessions',
      cookieCache: { enabled: false },
      fields: {
        userId: 'user_id',
        token: 'token',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        idToken: 'id_token',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        identifier: 'identifier',
        value: 'value',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    plugins: [bearer()],
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
      sendResetPassword: async () => {
        // Mail delivery is intentionally outside the authentication core.
        // The request remains enumeration-resistant until a mail transport is bound.
      },
    },
    advanced: {
      database: {
        generateId: (options) => {
          if (options.model === 'user' || options.model === 'users') return false
          return crypto.randomUUID()
        },
      },
    },
  })
}

export async function getBetterAuth(): Promise<BetterAuthInstance> {
  const context = await getCloudflareContext({ async: true })
  const env = context.env as unknown as BetterAuthEnv
  const cacheKey = env.D1 as unknown as object
  const existing = authCache.get(cacheKey)
  if (existing) return existing
  const auth = makeAuth(env)
  authCache.set(cacheKey, auth)
  return auth
}

export async function getBetterAuthSession(request: Request) {
  const auth = await getBetterAuth()
  const result = await auth.api.getSession({
    headers: request.headers,
  })
  return result
}

export async function handleBetterAuth(request: Request): Promise<Response> {
  const auth = await getBetterAuth()
  return auth.handler(request)
}

export type BetterAuthSession = Awaited<ReturnType<typeof getBetterAuthSession>>


export async function listBetterAuthSessions(request: Request) {
  const auth = await getBetterAuth()
  return auth.api.listSessions({
    headers: request.headers,
  })
}

export async function revokeBetterAuthSession(request: Request, token: string) {
  const auth = await getBetterAuth()
  return auth.api.revokeSession({
    body: { token },
    headers: request.headers,
  })
}
