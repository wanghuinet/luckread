import { describe, expect, it } from 'vitest'
import { resolveOptionalContentPrincipal } from './w03-content-client.js'

describe('W03 optional content principal resolution', () => {
  it('does not treat unrelated cookies as an authenticated session', async () => {
    const request = new Request('https://luckread.com/api/v1/contents/c1', {
      headers: { cookie: 'foo=bar' },
    })

    await expect(resolveOptionalContentPrincipal(request)).resolves.toBeNull()
  })

  it('does not treat an empty Authorization header as an authenticated session', async () => {
    const request = new Request('https://luckread.com/api/v1/contents/c1', {
      headers: { Authorization: '   ' },
    })

    await expect(resolveOptionalContentPrincipal(request)).resolves.toBeNull()
  })
})
