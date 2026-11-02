import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { payloadFind, callW03ContentMock } = vi.hoisted(() => ({ payloadFind: vi.fn(), callW03ContentMock: vi.fn() }))

vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ find: payloadFind })) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/auth/traffic-limit', () => ({
  enforcePublicReadRateLimit: vi.fn(async () => undefined),
  TrafficLimitError: class TrafficLimitError extends Error {},
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}))
vi.mock('@/content/w03-content-client', () => ({ callW03Content: callW03ContentMock }))

import { middleware } from '../../src/middleware'
import { Users } from '../../src/collections/Users'
import { GET as resolveUsernameRedirect } from '../../src/app/api/v1/redirects/username/[username]/route'

import {
  buildUsernameRedirectPathname,
  isUsernameRedirectActive,
  normalizeUsernameRedirectHandle,
  usernameRedirectExpiresAt,
  parseUsernameRoutePath,
  usernameRedirectFromPath,
  usernameRedirectTargetPath,
} from '../../src/lib/username-redirect'

describe('username 301 URL rules', () => {
  it('uses a case-folded history key and keeps the display username in the destination', () => {
    expect(usernameRedirectFromPath('HuiHui')).toBe('/@huihui')
    expect(usernameRedirectTargetPath('HuiXin')).toBe('/@HuiXin')
  })

  it('expires redirects after 30 days and treats the expiry instant as inactive', () => {
    const changedAt = new Date('2026-11-02T00:00:00.000Z')
    const expiresAt = '2026-12-02T00:00:00.000Z'
    expect(usernameRedirectExpiresAt(changedAt)).toBe(expiresAt)
    expect(isUsernameRedirectActive(expiresAt, new Date('2026-12-01T23:59:59.999Z'))).toBe(true)
    expect(isUsernameRedirectActive(expiresAt, new Date(expiresAt))).toBe(false)
    expect(isUsernameRedirectActive('not-a-date', changedAt)).toBe(false)
    expect(isUsernameRedirectActive(null, changedAt)).toBe(false)
  })

  it('preserves the content-type route and immutable content ID', () => {
    expect(parseUsernameRoutePath('/@huihui/post/2116861177622433792')).toEqual({
      username: 'huihui',
      suffix: '/post/2116861177622433792',
    })
    for (const type of ['post', 'article', 'video', 'short']) {
      expect(buildUsernameRedirectPathname(`/@huihui/${type}/2116861177622433792`, 'huixin')).toBe(
        `/@huixin/${type}/2116861177622433792`,
      )
    }
  })

  it('does not redirect to itself and rejects invalid or encoded-slash handles', () => {
    expect(buildUsernameRedirectPathname('/@huihui/video/42', 'HUIHUI')).toBeNull()
    expect(normalizeUsernameRedirectHandle('@huihui')).toBeNull()
    expect(normalizeUsernameRedirectHandle('short')).toBeNull()
    expect(normalizeUsernameRedirectHandle('hu_i_hui')).toBeNull()
    expect(normalizeUsernameRedirectHandle('hui-hui')).toBeNull()
    expect(normalizeUsernameRedirectHandle('hui hui')).toBeNull()
    expect(parseUsernameRoutePath('/@bad%2Fhandle/post/42')).toBeNull()
  })
})


describe('username redirect middleware', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues a no-store 301 and preserves the complete content path and query', async () => {
    const resolverFetch = vi.fn().mockResolvedValue(
      Response.json({ targetUsername: 'HuiXin' }, { status: 200 }),
    )
    vi.stubGlobal('fetch', resolverFetch)

    const response = await middleware(new NextRequest(
      'https://luckread.com/@huihui/post/2116861177622433792?lang=zh-CN&view=full',
    ))

    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe(
      'https://luckread.com/@HuiXin/post/2116861177622433792?lang=zh-CN&view=full',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(resolverFetch).toHaveBeenCalledTimes(1)
    const [resolverURL, options] = resolverFetch.mock.calls[0] as [URL, RequestInit]
    expect(resolverURL.pathname).toBe('/api/v1/redirects/username/huihui')
    expect(options.method).toBe('GET')
    expect(options.cache).toBe('no-store')
  })

  it('preserves article, video, and short content IDs while replacing only the username', async () => {
    for (const kind of ['article', 'video', 'short']) {
      const resolverFetch = vi.fn().mockResolvedValue(
        Response.json({ targetUsername: 'huixin' }, { status: 200 }),
      )
      vi.stubGlobal('fetch', resolverFetch)

      const response = await middleware(new NextRequest(
        'https://luckread.com/@huihui/' + kind + '/2116861177622433792',
      ))

      expect(response.status).toBe(301)
      expect(new URL(response.headers.get('location') ?? '').pathname).toBe(
        '/@huixin/' + kind + '/2116861177622433792',
      )
      vi.unstubAllGlobals()
    }
  })

  it('does not invoke the resolver for POST requests', async () => {
    const resolverFetch = vi.fn()
    vi.stubGlobal('fetch', resolverFetch)

    const response = await middleware(new NextRequest(
      'https://luckread.com/@huihui/post/2116861177622433792',
      { method: 'POST', body: 'server-action-payload' },
    ))

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(resolverFetch).not.toHaveBeenCalled()
  })

  it('passes through when no historical username redirect exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))

    const response = await middleware(new NextRequest('https://luckread.com/@huihui'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('fails closed when the redirect resolver is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('resolver unavailable')))

    const response = await middleware(new NextRequest('https://luckread.com/@huihui/post/42'))

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('does not redirect a username to itself', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      Response.json({ targetUsername: 'HUIHUI' }, { status: 200 }),
    ))

    const response = await middleware(new NextRequest('https://luckread.com/@huihui/video/42'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})



describe('username redirect resolver identity and expiry guards', () => {
  beforeEach(() => {
    payloadFind.mockReset()
  })

  const request = () => new Request('https://luckread.com/api/v1/redirects/username/oldname')
  const context = { params: Promise.resolve({ username: 'oldname' }) }

  it('returns a target only while the redirect is active and its identity still owns the destination', async () => {
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    payloadFind.mockImplementation(async (args: { collection: string }) => {
      if (args.collection === 'redirects') return { docs: [{
        type: '301', redirectScope: 'username', identityId: 'identity-1',
        destinationUsername: 'NewName', expiresAt: expiry,
        to: { type: 'custom', url: '/@NewName' },
      }] }
      return { docs: [{ identityId: 'identity-1', username: 'NewName' }] }
    })

    const response = await resolveUsernameRedirect(request(), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ targetUsername: 'NewName' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(payloadFind).toHaveBeenNthCalledWith(1, expect.objectContaining({
      collection: 'redirects', depth: 0, limit: 1, overrideAccess: true,
      where: { and: expect.arrayContaining([
        { from: { equals: '/@oldname' } },
        { redirectScope: { equals: 'username' } },
      ]) },
    }))
    expect(payloadFind).toHaveBeenNthCalledWith(2, expect.objectContaining({
      collection: 'users', where: { identityId: { equals: 'identity-1' } },
    }))
  })

  it('does not resolve an expired record even when a stale row is returned by the storage mock', async () => {
    payloadFind.mockResolvedValue({ docs: [{
      type: '301', redirectScope: 'username', identityId: 'identity-1',
      destinationUsername: 'NewName', expiresAt: '2026-01-01T00:00:00.000Z',
      to: { type: 'custom', url: '/@NewName' },
    }] })

    const response = await resolveUsernameRedirect(request(), context)
    expect(response.status).toBe(404)
    expect(payloadFind).toHaveBeenCalledTimes(1)
  })

  it('does not send an old identity to a destination username now owned by another handle', async () => {
    payloadFind.mockImplementation(async (args: { collection: string }) => {
      if (args.collection === 'redirects') return { docs: [{
        type: '301', redirectScope: 'username', identityId: 'identity-1',
        destinationUsername: 'ReclaimedName', expiresAt: new Date(Date.now() + 60_000).toISOString(),
        to: { type: 'custom', url: '/@ReclaimedName' },
      }] }
      return { docs: [{ identityId: 'identity-1', username: 'NewName' }] }
    })

    const response = await resolveUsernameRedirect(request(), context)
    expect(response.status).toBe(404)
    expect(payloadFind).toHaveBeenCalledTimes(2)
  })
})


describe('username redirect history hook', () => {
  const hook = Users.hooks?.afterChange?.[0] as unknown as (args: unknown) => Promise<unknown>
  const invoke = async (eligible: boolean, findResults: Array<{ docs: Array<{ identityId?: string; expiresAt?: string }> }>) => {
    const results = [...findResults]
    const find = vi.fn(async (_args: unknown) => results.shift() ?? { docs: [] })
    const create = vi.fn(async (_args: { data: Record<string, unknown> }) => undefined)
    const update = vi.fn(async (_args: { data?: Record<string, unknown> }) => undefined)
    const req = {
      headers: new Headers({ 'X-LuckRead-Correlation-Id': 'username-redirect-hook-test' }),
      payload: { find, create, update },
    }
    callW03ContentMock.mockResolvedValue(Response.json({ data: { eligible } }))
    const doc = { username: 'NewName', identityId: 'identity-1' }
    await hook({ doc, operation: 'update', previousDoc: { username: 'OldName' }, req })
    return { find, create, update }
  }

  beforeEach(() => {
    callW03ContentMock.mockReset()
  })

  it('does not create a new 301 for an account without published public content', async () => {
    const result = await invoke(false, [{ docs: [] }])
    expect(result.find).toHaveBeenCalledTimes(1)
    expect(result.create).not.toHaveBeenCalled()
    expect(result.update).not.toHaveBeenCalled()
  })

  it('creates a 30-day 301 only after W03 confirms public published content', async () => {
    const result = await invoke(true, [{ docs: [] }, { docs: [] }])
    expect(result.create).toHaveBeenCalledTimes(1)
    const data = result.create.mock.calls[0]?.[0].data
    expect(data).toMatchObject({
      from: '/@oldname',
      to: { type: 'custom', url: '/@NewName' },
      type: '301', redirectScope: 'username', identityId: 'identity-1',
      sourceUsername: 'OldName', destinationUsername: 'NewName',
    })
    const remainingMs = Date.parse(String(data?.expiresAt)) - Date.now()
    expect(remainingMs).toBeGreaterThan(30 * 24 * 60 * 60 * 1000 - 60_000)
    expect(remainingMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000)
    expect(callW03ContentMock).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/internal/content/username-redirect-eligibility/identity-1', method: 'GET',
    }))
  })

  it('retargets active history without extending its original expiry', async () => {
    const originalExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
    const result = await invoke(true, [
      { docs: [{ identityId: 'identity-1', expiresAt: originalExpiry }] },
      { docs: [{ identityId: 'identity-1', expiresAt: originalExpiry }] },
    ])
    expect(result.update).toHaveBeenCalledTimes(2)
    const updates = result.update.mock.calls.map(call => call[0])
    expect(updates[0]?.data).not.toHaveProperty('expiresAt')
    expect(updates[1]?.data).toMatchObject({ expiresAt: originalExpiry, to: { url: '/@NewName' } })
    expect(result.create).not.toHaveBeenCalled()
  })

  it('reuses an expired unique source row in place with a new 30-day lease', async () => {
    const result = await invoke(true, [
      { docs: [] },
      { docs: [{ identityId: 'former-identity', expiresAt: '2026-01-01T00:00:00.000Z' }] },
    ])
    expect(result.create).not.toHaveBeenCalled()
    expect(result.update).toHaveBeenCalledTimes(1)
    const data = result.update.mock.calls[0]?.[0].data
    expect(data).toMatchObject({ identityId: 'identity-1', from: '/@oldname' })
    const remainingMs = Date.parse(String(data?.expiresAt)) - Date.now()
    expect(remainingMs).toBeGreaterThan(30 * 24 * 60 * 60 * 1000 - 60_000)
    expect(remainingMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000)
  })
})
