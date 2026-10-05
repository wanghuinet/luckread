import { describe, expect, it, vi } from 'vitest'

const { getPayloadMock, revokeSessionMock, W02AuthClientErrorMock } = vi.hoisted(() => {
  class W02AuthClientErrorMock extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }

  return {
    getPayloadMock: vi.fn(),
    revokeSessionMock: vi.fn(),
    W02AuthClientErrorMock,
  }
})

vi.mock('payload', () => ({
  getPayload: getPayloadMock,
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  revokeSession: revokeSessionMock,
  W02AuthClientError: W02AuthClientErrorMock,
}))

import { POST } from '../../src/app/auth/logout/route'

function setup(user: { id?: string | number; _sid?: string } | null = { id: 'user-1', _sid: 'sid-1' }) {
  const auth = vi.fn().mockResolvedValue({ user })
  getPayloadMock.mockResolvedValue({ auth })
  revokeSessionMock.mockResolvedValue({ revoked: true })
  return { auth }
}

describe('AUTH-002 /auth/logout adapter', () => {
  it('revokes the current native session and returns an empty 204 response', async () => {
    setup()

    const response = await POST(new Request('https://example.test/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer access-token' },
    }))

    expect(revokeSessionMock).toHaveBeenCalledWith({ sessionId: 'sid-1' })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('does not accept a client-supplied session identifier', async () => {
    setup()

    const response = await POST(new Request('https://example.test/auth/logout?sessionId=attacker-session', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer access-token',
        'x-session-id': 'attacker-session',
      },
    }))

    expect(revokeSessionMock).toHaveBeenCalledWith({ sessionId: 'sid-1' })
    expect(response.status).toBe(204)
  })

  it('keeps logout idempotent when the current native session is already unavailable', async () => {
    setup(null)

    const response = await POST(new Request('https://example.test/auth/logout', {
      method: 'POST',
    }))

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(revokeSessionMock).not.toHaveBeenCalled()
  })

  it('fails closed on an internal Payload authentication error', async () => {
    const auth = vi.fn().mockRejectedValue(new Error('native auth unavailable'))
    getPayloadMock.mockResolvedValue({ auth })

    const response = await POST(new Request('https://example.test/auth/logout', {
      method: 'POST',
    }))

    expect(response.status).toBe(503)
    expect(revokeSessionMock).not.toHaveBeenCalled()
  })

  it('returns a generic service error when W02 revocation is unavailable', async () => {
    setup()
    revokeSessionMock.mockRejectedValueOnce(new W02AuthClientErrorMock(503, 'internal details'))

    const response = await POST(new Request('https://example.test/auth/logout', {
      method: 'POST',
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
      },
    })
    const body = await response.text().catch(() => '')
    expect(body).not.toContain('internal details')
  })
})
