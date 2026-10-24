import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import worker from '../index.js'

const env = {} as never

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
    ), env)
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
    ), env)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    })
  })

  it('uses W02-owned account state and ignores a caller-supplied ACTIVE state', async () => {
    type TestStatement = {
      bind: (...values: unknown[]) => TestStatement
      first: <T>() => Promise<T | null>
      all: <T>() => Promise<{ results: T[] }>
    }
    const db = {
      prepare: (sql: string) => {
        const statement: TestStatement = {
          bind: (..._values: unknown[]) => statement,
          first: async <T>() => sql.includes('FROM "user"')
            ? ({ accountState: 'SUSPENDED' } as T)
            : null,
          all: async <T>() => ({ results: [] as T[] }),
        }
        return statement
      },
    }
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
    ), { D1_01: db } as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ decision: 'DENY' })
  })

  it('does not accept a request-body MFA boolean as authentication evidence', () => {
    const path = fileURLToPath(new URL('../index.ts', import.meta.url))
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/mfaVerified\s*:\s*true/)
    expect(source).not.toMatch(/mfaVerified\??\s*:/)
    expect(source).toContain('verifyTargetBoundSingleApproval')
    expect(source).toContain('bootstrapSuperAdmin(env.D1_01, approval')

    const authSource = readFileSync(fileURLToPath(new URL('../auth/better-auth.ts', import.meta.url)), 'utf8')
    expect(authSource).toContain('trustDeviceMaxAge: 0')
    expect(authSource).toContain('skipVerificationOnEnable: false')
    expect(authSource).toContain('totpOptions: { allowPasswordless: false }')
    expect(authSource).not.toMatch(/sendOTP\s*:/)
  })
})
