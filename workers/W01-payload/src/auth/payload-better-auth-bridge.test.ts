import { describe, expect, it } from 'vitest'

import {
  createPayloadBetterAuthBridgeToken,
  verifyPayloadBetterAuthBridgeToken,
} from './payload-better-auth-bridge.js'

const secret = 'bridge-test-secret'
const now = new Date('2026-10-06T02:00:00.000Z')

describe('Payload Better Auth bridge', () => {
  it('binds identity to method, path and a short expiration window', async () => {
    const token = await createPayloadBetterAuthBridgeToken(secret, {
      sub: 'user_123',
      email: 'User@Example.com',
      method: 'POST',
      path: '/api/media',
    }, now)

    const verified = await verifyPayloadBetterAuthBridgeToken(
      secret,
      token,
      new Request('https://luckread-w01.internal/api/media', { method: 'POST' }),
      now,
    )

    expect(verified).toMatchObject({
      v: 1,
      sub: 'user_123',
      email: 'user@example.com',
      aud: 'luckread-w01-payload-media',
      method: 'POST',
      path: '/api/media',
    })
  })

  it('rejects a token with a different method or path', async () => {
    const token = await createPayloadBetterAuthBridgeToken(secret, {
      sub: 'user_123',
      email: 'user@example.com',
      method: 'POST',
      path: '/api/media',
    }, now)

    await expect(
      verifyPayloadBetterAuthBridgeToken(
        secret,
        token,
        new Request('https://luckread-w01.internal/api/media/123', { method: 'POST' }),
        now,
      ),
    ).resolves.toBeNull()

    await expect(
      verifyPayloadBetterAuthBridgeToken(
        secret,
        token,
        new Request('https://luckread-w01.internal/api/media', { method: 'PATCH' }),
        now,
      ),
    ).resolves.toBeNull()
  })

  it('rejects a token when the signature is tampered or expired', async () => {
    const token = await createPayloadBetterAuthBridgeToken(secret, {
      sub: 'user_123',
      email: 'user@example.com',
      method: 'GET',
      path: '/api/media/123',
    }, now)

    const parts = token.split('.')
    const tampered = parts[0] + '.' + parts[1].slice(0, -1) + (parts[1].endsWith('a') ? 'b' : 'a')

    await expect(
      verifyPayloadBetterAuthBridgeToken(
        secret,
        tampered,
        new Request('https://luckread-w01.internal/api/media/123', { method: 'GET' }),
        now,
      ),
    ).resolves.toBeNull()

    await expect(
      verifyPayloadBetterAuthBridgeToken(
        secret,
        token,
        new Request('https://luckread-w01.internal/api/media/123', { method: 'GET' }),
        new Date('2026-10-06T02:01:01.000Z'),
      ),
    ).resolves.toBeNull()
  })
})
