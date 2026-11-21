import { describe, expect, it } from 'vitest'
import { relayW05Response } from '../../src/social/w05-response.js'

describe('W05 response forwarding', () => {
  it.each([204, 205, 304])('preserves bodyless status %s without manufacturing a body', async (status) => {
    const upstream = new Response(null, { status })
    const downstream = await relayW05Response(upstream, new Headers({ 'cache-control': 'no-store' }))
    expect(downstream.status).toBe(status)
    expect(downstream.body).toBeNull()
    expect(await downstream.text()).toBe('')
  })

  it('preserves response body and headers for normal successful responses', async () => {
    const upstream = new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
    const downstream = await relayW05Response(upstream, upstream.headers)
    expect(downstream.status).toBe(200)
    expect(downstream.headers.get('content-type')).toContain('application/json')
    await expect(downstream.json()).resolves.toEqual({ data: { ok: true } })
  })
})
