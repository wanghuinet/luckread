import { describe, expect, it } from 'vitest'
import worker from './index.js'

const makeJsonBody = (size: number): string =>
  JSON.stringify({ identityType: 'email', identity: 'user@example.com', credential: 'x'.repeat(size), username: 'user', consent: {} })

describe('W02 internal JSON body boundary', () => {
  it('rejects an oversized internal registration body before persistence work', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w02.internal/internal/auth/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
        },
        body: makeJsonBody(64 * 1024),
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'invalid registration request',
      },
    })
  })

  it('rejects an oversized internal profile update before authentication or persistence', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w02.internal/internal/account/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'If-Match': 'W/"placeholder"',
          'X-LuckRead-Caller': 'W01',
        },
        body: JSON.stringify({ bio: 'x'.repeat(64 * 1024) }),
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid profile update',
      },
    })
  })
})
