import { describe, expect, it, vi } from 'vitest'
import { fetchJson, getApiErrorMessage, jsonHeaders, readJson, resolvePublicApiRequestUrl } from './client-api.js'

describe('client API primitives', () => {
  it('routes same-origin API paths through the canonical API host without rewriting media hosts', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'mp.luckread.com',
        origin: 'https://mp.luckread.com',
      },
    })

    try {
      expect(resolvePublicApiRequestUrl('/api/v1/media/file/article.json'))
        .toBe('https://api.luckread.com/v1/media/file/article.json')
      expect(resolvePublicApiRequestUrl('https://luckread.com/api/v1/media/file/article.json'))
        .toBe('https://api.luckread.com/v1/media/file/article.json')
      expect(resolvePublicApiRequestUrl('https://www.luckread.com/api/v1/media/file/article.json'))
        .toBe('https://api.luckread.com/v1/media/file/article.json')
      expect(resolvePublicApiRequestUrl('https://img.luckread.com/media/article.json'))
        .toBe('https://img.luckread.com/media/article.json')
      expect(resolvePublicApiRequestUrl('https://video.luckread.com/media/article-body.mp4'))
        .toBe('https://video.luckread.com/media/article-body.mp4')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads JSON responses without failing on non-JSON bodies', async () => {
    await expect(readJson(new Response(JSON.stringify({ ok: true })))).resolves.toEqual({ ok: true })
    await expect(readJson(new Response('not-json'))).resolves.toBeNull()
  })

  it('returns the response together with parsed JSON data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))

    await expect(fetchJson<{ ok: boolean }>('/api/example')).resolves.toMatchObject({
      data: { ok: true },
    })
    expect(fetch).toHaveBeenCalledWith('/api/example', undefined)

    vi.unstubAllGlobals()
  })

  it('extracts API error messages with a safe fallback', () => {
    expect(getApiErrorMessage({ error: { message: '失败' } }, '默认')).toBe('失败')
    expect(getApiErrorMessage({ error: { message: '   ' } }, '默认')).toBe('默认')
    expect(getApiErrorMessage(null, '默认')).toBe('默认')
  })

  it('builds JSON headers without overriding explicit values', () => {
    const headers = jsonHeaders({ 'X-Test': '1' })
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-test')).toBe('1')

    const existing = jsonHeaders({
      accept: 'application/problem+json',
      'content-type': 'application/custom',
    })
    expect(existing.get('accept')).toBe('application/problem+json')
    expect(existing.get('content-type')).toBe('application/custom')
  })
})
