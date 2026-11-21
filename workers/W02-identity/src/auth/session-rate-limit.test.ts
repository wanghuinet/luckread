import { describe, expect, it, vi } from 'vitest'
import type { BetterAuthEnv } from './better-auth.js'
import {
  enforceSessionListRateLimits,
  enforceSessionRevokeRateLimits,
  SessionRateLimitError,
} from './session-rate-limit.js'

const makeEnv = (overrides: Partial<BetterAuthEnv> = {}): BetterAuthEnv => ({
  D1_01: {} as D1Database,
  AUTH_SESSION_READ_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  AUTH_SESSION_WRITE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  ...overrides,
})

describe('AUTH-010 session anti-abuse scopes', () => {
  it('applies account and endpoint keys for listing', async () => {
    const env = makeEnv()
    const limiter = env.AUTH_SESSION_READ_LIMITER!
    await enforceSessionListRateLimits(env, 'user-17')
    expect(limiter.limit).toHaveBeenNthCalledWith(1, { key: 'auth010:session-list:account:user-17' })
    expect(limiter.limit).toHaveBeenNthCalledWith(2, { key: 'auth010:session-list:endpoint' })
  })

  it('applies account, authenticated-caller-session, and endpoint keys for revoke', async () => {
    const env = makeEnv()
    const limiter = env.AUTH_SESSION_WRITE_LIMITER!
    await enforceSessionRevokeRateLimits(env, 'user-17', 'caller-session-29')
    expect(limiter.limit).toHaveBeenNthCalledWith(1, { key: 'auth010:session-revoke:account:user-17' })
    expect(limiter.limit).toHaveBeenNthCalledWith(2, { key: 'auth010:session-revoke:session:caller-session-29' })
    expect(limiter.limit).toHaveBeenNthCalledWith(3, { key: 'auth010:session-revoke:endpoint' })
  })

  it('stops when a required scope is blocked', async () => {
    const limit = vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false })
    const env = makeEnv({ AUTH_SESSION_READ_LIMITER: { limit } })
    await expect(enforceSessionListRateLimits(env, 'user-17')).rejects.toMatchObject({ reason: 'limited' })
    expect(limit).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a required binding is absent or throws', async () => {
    const missing = makeEnv({ AUTH_SESSION_READ_LIMITER: undefined })
    await expect(enforceSessionListRateLimits(missing, 'user-17')).rejects.toBeInstanceOf(SessionRateLimitError)
    const throwing = makeEnv({
      AUTH_SESSION_WRITE_LIMITER: { limit: vi.fn().mockRejectedValue(new Error('rate limit runtime unavailable')) },
    })
    await expect(enforceSessionRevokeRateLimits(throwing, 'user-17', 'session-29'))
      .rejects.toMatchObject({ reason: 'unavailable' })
  })
})
