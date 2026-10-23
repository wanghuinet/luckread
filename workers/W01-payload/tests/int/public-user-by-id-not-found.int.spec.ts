import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findByID } = vi.hoisted(() => ({ findByID: vi.fn() }))

vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ findByID })),
}))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforcePublicReadRateLimit: vi.fn(async () => undefined),
  TrafficLimitError: class TrafficLimitError extends Error {},
  rateLimitResponse: vi.fn(() => Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })),
}))
vi.mock('../../src/lib/public-response-cache.js', () => ({
  cachedPublicGet: vi.fn(async (
    _request: Request,
    _namespace: string,
    loader: () => Promise<Response>,
  ) => loader()),
}))

import { GET } from '../../src/app/api/v1/users/[userId]/route.js'

describe('public profile lookup by Payload user ID', () => {
  beforeEach(() => {
    findByID.mockReset()
  })

  it('returns the documented 404 for a Payload not-found exception', async () => {
    findByID.mockRejectedValueOnce(Object.assign(new Error('User not found'), { status: 404 }))

    const response = await GET(
      new Request('https://api.luckread.com/v1/users/999999'),
      { params: Promise.resolve({ userId: '999999' }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'NOT_FOUND', message: 'User not found' },
    })
  })

  it('keeps infrastructure failures as 503 instead of misclassifying them as missing users', async () => {
    findByID.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await GET(
      new Request('https://api.luckread.com/v1/users/999999'),
      { params: Promise.resolve({ userId: '999999' }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    })
  })
})
