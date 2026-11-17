import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const { roleLayerStore, neonRuntime } = vi.hoisted(() => {
  const roleLayerStore = {
    readAccountState: vi.fn(async () => 'SUSPENDED'),
    resolveGlobalLayer: vi.fn(async (_subjectId: string, accountState: string) => ({
      decision: accountState === 'SUSPENDED' ? 'DENY' : 'ALLOW',
    })),
  }
  return {
    roleLayerStore,
    neonRuntime: {
      pool: {},
      roleLayerStore,
    },
  }
})

vi.mock('../neon/runtime.js', () => ({
  getW02PostgresRuntime: vi.fn(() => neonRuntime),
}))

import worker from '../index.js'

const neonProductionEnv = {
  W02_DATABASE_DRIVER: 'neon',
  HYPERDRIVE: {
    connectionString: 'postgresql://test:test@localhost:5432/luckread',
  },
} as never

describe('W02 L8 genesis bootstrap service-boundary gate', () => {
  it('rejects direct write-route calls without trusted W01 service headers', async () => {
    const response = await worker.fetch(new Request(
      'https://luckread-w02.internal/internal/authz/bootstrap-super-admin',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestPrNumber: 77,
          githubToken: 'ghs_' + 'x'.repeat(40),
          mfaVerified: true,
        }),
      },
    ), neonProductionEnv)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    })
  })

  it('rejects direct read-only readiness calls without trusted W01 service headers', async () => {
    const response = await worker.fetch(new Request(
      'https://luckread-w02.internal/internal/authz/bootstrap-super-admin/readiness',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestPrNumber: 77,
          githubToken: 'ghs_' + 'x'.repeat(40),
          mfaVerified: true,
        }),
      },
    ), neonProductionEnv)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    })
  })

  it('uses W02-owned PostgreSQL account state and ignores caller-supplied ACTIVE state', async () => {
    roleLayerStore.readAccountState.mockClear()
    roleLayerStore.resolveGlobalLayer.mockClear()

    const response = await worker.fetch(new Request(
      'https://luckread-w02.internal/internal/authz/resolve-layer',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subjectId: 'existing-user-123',
          accountState: 'ACTIVE',
          now: '2000-01-01T00:00:00.000Z',
        }),
      },
    ), neonProductionEnv)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ decision: 'DENY' })
    expect(roleLayerStore.readAccountState).toHaveBeenCalledWith('existing-user-123')
    expect(roleLayerStore.resolveGlobalLayer).toHaveBeenCalledWith(
      'existing-user-123',
      'SUSPENDED',
      expect.any(String),
    )
  })

  it('does not accept a request-body MFA boolean as authentication evidence', () => {
    const path = fileURLToPath(new URL('../index.ts', import.meta.url))
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/mfaVerified\s*:\s*true/)
    expect(source).not.toMatch(/mfaVerified\\??\s*:/)
    expect(source).toContain('verifyTargetBoundSingleApproval')
    expect(source).toContain('bootstrapSuperAdminPostgres(postgres.pool, approval')

    const authSource = readFileSync(fileURLToPath(new URL('../auth/better-auth.ts', import.meta.url)), 'utf8')
    expect(authSource).toContain('trustDeviceMaxAge: 0')
    expect(authSource).toContain('skipVerificationOnEnable: false')
    expect(authSource).toContain('totpOptions: { allowPasswordless: false }')
    expect(authSource).not.toMatch(/sendOTP\s*:/)
  })
})
