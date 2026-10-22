import { getCloudflareContext } from '@opennextjs/cloudflare'

type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>
}

export class TrafficLimitError extends Error {
  constructor(readonly retryAfterSeconds = 60) {
    super('RATE_LIMITED')
  }
}

export async function enforceAuthRateLimit(
  request: Request,
  bindingName: 'AUTH_REGISTER_LIMITER' | 'AUTH_LOGIN_LIMITER' | 'AUTH_REFRESH_LIMITER',
  keyParts: string[],
): Promise<void> {
  let env: Record<string, unknown>
  try {
    const context = await getCloudflareContext({ async: true })
    env = context.env as unknown as Record<string, unknown>
  } catch {
    return
  }
  const globalLimiter = env.AUTH_ORIGIN_GLOBAL_LIMITER as RateLimitBinding | undefined
  if (globalLimiter) {
    const globalResult = await globalLimiter.limit({ key: bindingName + ':origin' })
    if (!globalResult.success) throw new TrafficLimitError()
  }

  const limiter = env[bindingName] as RateLimitBinding | undefined
  if (!limiter) throw new Error('RATE_LIMIT_BINDING_UNAVAILABLE:' + bindingName)

  const key = [bindingName, ...keyParts.map((part) => part.trim()).filter(Boolean)].join(':')
  const result = await limiter.limit({ key })
  if (!result.success) throw new TrafficLimitError()
}

export const rateLimitResponse = (request: Request): Response =>
  Response.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        details: { retryAfter: 60 },
      },
      requestId: `req_${crypto.randomUUID()}`,
    },
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '60',
        'x-luckread-rate-limit-scope': request.headers.get('Authorization') ? 'principal' : 'edge',
      },
    },
  )


export async function enforcePublicReadRateLimit(request: Request): Promise<void> {
  let env: Record<string, unknown>
  try {
    const context = await getCloudflareContext({ async: true })
    env = context.env as unknown as Record<string, unknown>
  } catch {
    return
  }

  const globalLimiter = env.PUBLIC_ORIGIN_GLOBAL_LIMITER as RateLimitBinding | undefined
  if (globalLimiter) {
    const result = await globalLimiter.limit({ key: 'public-read:origin' })
    if (!result.success) throw new TrafficLimitError()
  }

  const limiter = env.PUBLIC_READ_LIMITER as RateLimitBinding | undefined
  if (!limiter) throw new Error('RATE_LIMIT_BINDING_UNAVAILABLE:PUBLIC_READ_LIMITER')
  const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
  const result = await limiter.limit({ key: 'public-read:ip:' + clientIp })
  if (!result.success) throw new TrafficLimitError()
}


export async function enforceW01WriteRateLimit(request: Request): Promise<void> {
  let env: Record<string, unknown>
  try {
    const context = await getCloudflareContext({ async: true })
    env = context.env as unknown as Record<string, unknown>
  } catch {
    return
  }

  const globalLimiter = env.W01_WRITE_ORIGIN_GLOBAL_LIMITER as RateLimitBinding | undefined
  if (!globalLimiter) throw new Error('RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_ORIGIN_GLOBAL_LIMITER')
  const globalResult = await globalLimiter.limit({ key: 'w01-write:origin' })
  if (!globalResult.success) throw new TrafficLimitError()

  const limiter = env.W01_WRITE_LIMITER as RateLimitBinding | undefined
  if (!limiter) throw new Error('RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_LIMITER')
  const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
  const result = await limiter.limit({ key: 'w01-write:ip:' + clientIp })
  if (!result.success) throw new TrafficLimitError()
}

/**
 * Apply the authenticated actor-account bucket after W01 has established the
 * Better Auth principal. The edge/IP and origin guards remain before auth.
 */
export async function enforceW01WriteAccountRateLimit(accountId: string): Promise<void> {
  const subject = accountId.trim()
  if (!subject || subject.length > 128) {
    throw new Error('RATE_LIMIT_ACCOUNT_SUBJECT_INVALID')
  }

  let env: Record<string, unknown>
  try {
    const context = await getCloudflareContext({ async: true })
    env = context.env as unknown as Record<string, unknown>
  } catch {
    return
  }

  const limiter = env.W01_WRITE_LIMITER as RateLimitBinding | undefined
  if (!limiter) throw new Error('RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_LIMITER')
  const result = await limiter.limit({ key: 'w01-write:account:' + encodeURIComponent(subject) })
  if (!result.success) throw new TrafficLimitError()
}


/**
 * Apply the per-operation bucket for a fixed W01 route. The endpoint identifier
 * must be a stable operation name, never a user-controlled URL or path.
 */
export async function enforceW01WriteEndpointRateLimit(endpoint: string): Promise<void> {
  const operation = endpoint.trim()
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(operation)) {
    throw new Error('RATE_LIMIT_ENDPOINT_INVALID')
  }

  let env: Record<string, unknown>
  try {
    const context = await getCloudflareContext({ async: true })
    env = context.env as unknown as Record<string, unknown>
  } catch {
    return
  }

  const limiter = env.W01_WRITE_LIMITER as RateLimitBinding | undefined
  if (!limiter) throw new Error('RATE_LIMIT_BINDING_UNAVAILABLE:W01_WRITE_LIMITER')
  const result = await limiter.limit({ key: 'w01-write:endpoint:' + encodeURIComponent(operation) })
  if (!result.success) throw new TrafficLimitError()
}
