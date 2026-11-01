import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { middleware } from '../../src/middleware'

import {
  buildUsernameRedirectPathname,
  normalizeUsernameRedirectHandle,
  parseUsernameRoutePath,
  usernameRedirectFromPath,
  usernameRedirectTargetPath,
} from '../../src/lib/username-redirect'

describe('username 301 URL rules', () => {
  it('uses a case-folded history key and keeps the display username in the destination', () => {
    expect(usernameRedirectFromPath('HuiHui')).toBe('/@huihui')
    expect(usernameRedirectTargetPath('HuiXin')).toBe('/@HuiXin')
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

