import { describe, expect, it, vi } from 'vitest'
import { fetchJson, getApiErrorMessage, jsonHeaders, readJson } from './client-api.js'

describe('client API primitives', () => {
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
