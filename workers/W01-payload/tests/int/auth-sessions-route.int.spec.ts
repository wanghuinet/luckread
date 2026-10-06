import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  revokeOwnedSession: vi.fn(),
  W02AuthClientError: class extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
}))

vi.mock('../../src/auth/w02-auth-client.js', () => ({
  listSessions: mocks.listSessions,
  revokeOwnedSession: mocks.revokeOwnedSession,
  W02AuthClientError: mocks.W02AuthClientError,
}))

import { DELETE, GET } from '../../src/app/auth/sessions/[[...segments]]/route.js'

const rootContext = { params: Promise.resolve({ segments: [] }) }

describe('Better Auth native session management route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listSessions.mockResolvedValue({
      currentSessionId: 'session-current',
      items: [{
        sessionId: 'session-current',
        deviceId: null,
        createdAt: '2026-10-02T00:00:00.000Z',
        expiresAt: '2026-10-09T00:00:00.000Z',
        lastSeenAt: '2026-10-02T00:00:00.000Z',
      }],
      nextCursor: null,
    })
    mocks.revokeOwnedSession.mockResolvedValue({ revoked: true })
  })

  it('delegates session listing to the Better Auth-backed W02 client', async () => {
    const request = new Request('https://luckread.test/auth/sessions?cursor=c1&limit=20')

    const response = await GET(request, rootContext)

    expect(response.status).toBe(200)
    expect(mocks.listSessions).toHaveBeenCalledWith(request, {
      cursor: 'c1',
      limit: 20,
    })
  })

  it('rejects malformed list limits before contacting W02', async () => {
    const request = new Request('https://luckread.test/auth/sessions?limit=101')

    const response = await GET(request, rootContext)

    expect(response.status).toBe(400)
    expect(mocks.listSessions).not.toHaveBeenCalled()
  })

  it('delegates owned-session revocation without exposing another session implementation', async () => {
    const request = new Request('https://luckread.test/auth/sessions/session-target', {
      method: 'DELETE',
    })

    const response = await DELETE(request, {
      params: Promise.resolve({ segments: ['session-target'] }),
    })

    expect(response.status).toBe(204)
    expect(mocks.revokeOwnedSession).toHaveBeenCalledWith(request, 'session-target')
  })

  it('maps W02 authentication failures', async () => {
    mocks.listSessions.mockRejectedValue(new mocks.W02AuthClientError(401, 'authentication required'))

    const response = await GET(new Request('https://luckread.test/auth/sessions'), rootContext)

    expect(response.status).toBe(401)
  })
})
