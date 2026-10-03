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
  if (!limiter) return

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
      requestId: crypto.randomUUID(),
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
  if (!limiter) return
  const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
  const result = await limiter.limit({ key: 'public-read:ip:' + clientIp })
  if (!result.success) throw new TrafficLimitError()
}
