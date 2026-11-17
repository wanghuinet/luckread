import { describe, expect, it, vi } from 'vitest'

const { registrationRollbackStore, neonRuntime } = vi.hoisted(() => {
  const registrationRollbackStore = {
    confirmIdentity: vi.fn(async () => ({
      identityById: {
        id: 'identity-user-123',
        email: 'person@example.test',
        username: 'person123',
      },
      identityByEmailId: 'identity-user-123',
    })),
    rollback: vi.fn(async () => ({ rolledBack: true })),
  }
  return {
    registrationRollbackStore,
    neonRuntime: { pool: {}, registrationRollbackStore },
  }
})

vi.mock('../neon/runtime.js', () => ({
  getW02PostgresRuntime: vi.fn(() => neonRuntime),
}))

import worker from '../index.js'

const neonEnv = {
  W02_DATABASE_DRIVER: 'neon',
  HYPERDRIVE: {
    connectionString: 'postgresql://test:test@localhost:5432/luckread',
  },
} as never

const body = {
  userId: 'identity-user-123',
  email: 'person@example.test',
}

const trustedHeaders = {
  'content-type': 'application/json',
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
}

describe('W02 registration identity confirmation service boundary', () => {
  it('rejects callers outside the W01 service boundary before reading identity data', async () => {
    registrationRollbackStore.confirmIdentity.mockClear()
    const response = await worker.fetch(new Request(
      'https://luckread-w02.internal/internal/auth/registration/identity-confirmation',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ), neonEnv)

    expect(response.status).toBe(403)
    expect(registrationRollbackStore.confirmIdentity).not.toHaveBeenCalled()
  })

  it('returns only the W02-owned identity confirmation DTO to trusted W01', async () => {
    registrationRollbackStore.confirmIdentity.mockClear()
    const response = await worker.fetch(new Request(
      'https://luckread-w02.internal/internal/auth/registration/identity-confirmation',
      {
        method: 'POST',
        headers: trustedHeaders,
        body: JSON.stringify(body),
      },
    ), neonEnv)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      identityById: {
        id: 'identity-user-123',
        email: 'person@example.test',
        username: 'person123',
      },
      identityByEmailId: 'identity-user-123',
    })
    expect(registrationRollbackStore.confirmIdentity).toHaveBeenCalledWith(body)
  })

  it('rejects malformed confirmation input before querying W02 storage', async () => {
    registrationRollbackStore.confirmIdentity.mockClear()
    const response = await worker.fetch(new Request(
      'https://luckread-w02.internal/internal/auth/registration/identity-confirmation',
      {
        method: 'POST',
        headers: trustedHeaders,
        body: JSON.stringify({ userId: '', email: 'not-an-email' }),
      },
    ), neonEnv)

    expect(response.status).toBe(400)
    expect(registrationRollbackStore.confirmIdentity).not.toHaveBeenCalled()
  })
})
