import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(),
}))

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { authorizePayloadAdmin } from './w02-session-client.js'

const contextMock = vi.mocked(getCloudflareContext)

afterEach(() => {
  vi.clearAllMocks()
})

describe('W01 → W02 auth transport', () => {
  it('stamps the trusted W01 caller on Payload Admin authorization requests', async () => {
    let forwarded: Request | null = null

    const service = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        forwarded = input instanceof Request ? input : new Request(input)
        return new Response(JSON.stringify({ allowed: true, layer: 'L8' }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      }),
    }

    contextMock.mockResolvedValue({ env: { W02_AUTH: service } } as never)

    await expect(authorizePayloadAdmin('42')).resolves.toEqual({
      allowed: true,
      layer: 'L8',
    })

    expect(forwarded?.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(forwarded?.headers.get('content-type')).toContain('application/json')
    expect(await forwarded?.text()).toBe(JSON.stringify({ userId: '42' }))
  })
})
