import { describe, expect, it, vi } from 'vitest'

const { signOutThroughW02Mock, W02AuthClientErrorMock } = vi.hoisted(() => {
  class W02AuthClientErrorMock extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }

  return {
    signOutThroughW02Mock: vi.fn(),
    W02AuthClientErrorMock,
  }
})

vi.mock('../../src/auth/w02-session-client.js', () => ({
  signOutThroughW02: signOutThroughW02Mock,
  W02AuthClientError: W02AuthClientErrorMock,
}))

import { POST } from '../../src/app/auth/logout/route'

describe('AUTH-002 /auth/logout W02 authority adapter', () => {
  it('delegates logout to W02 Better Auth and returns 204 while forwarding the native clear cookie', async () => {
    signOutThroughW02Mock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly' },
    }))

    const response = await POST(new Request('https://luckread.test/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: 'better-auth.session_token=opaque-session',
        Authorization: 'Bearer compatibility-token',
      },
    }))

    expect(signOutThroughW02Mock).toHaveBeenCalledTimes(1)
    expect(signOutThroughW02Mock.mock.calls[0][0]).toBeInstanceOf(Request)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('payload-token=')
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=')
  })

  it('does not accept a client-supplied session identifier', async () => {
    signOutThroughW02Mock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const response = await POST(new Request('https://luckread.test/auth/logout?sessionId=attacker-session', {
      method: 'POST',
      headers: {
        Cookie: 'better-auth.session_token=opaque-session',
        'x-session-id': 'attacker-session',
      },
    }))

    expect(response.status).toBe(204)
    expect(signOutThroughW02Mock).toHaveBeenCalledTimes(1)
  })

  it('keeps logout idempotent when W02 reports that the native session is already unavailable', async () => {
    signOutThroughW02Mock.mockResolvedValueOnce(new Response(null, { status: 401 }))

    const response = await POST(new Request('https://luckread.test/auth/logout', {
      method: 'POST',
    }))

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('fails closed on W02 infrastructure failure', async () => {
    signOutThroughW02Mock.mockRejectedValueOnce(new W02AuthClientErrorMock(503, 'internal details'))

    const response = await POST(new Request('https://luckread.test/auth/logout', {
      method: 'POST',
    }))

    expect(response.status).toBe(503)
    const body = await response.text()
    expect(body).not.toContain('internal details')
    expect(signOutThroughW02Mock).toHaveBeenCalledTimes(1)
  })
})
