import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned auth register adapter', () => {
  it('exposes the Better Auth-backed registration handler under /api/v1/auth/register', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/auth/register/route.ts'),
      'utf8',
    )

    expect(route).toContain("export { POST } from '../../../../auth/register/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('payload.create(')
    expect(route).toContain('registerWithBetterAuth')
    expect(route).toContain('validatePolicy(')
    expect(route).not.toContain('auth_registration_envelopes')
  })
})

  it('keeps registration idempotency and policy validation at the public gateway', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/auth/register/route.ts'),
      'utf8',
    )

    expect(route).toContain("request.headers.get('Idempotency-Key')")
    expect(route).toContain("AUTH_REGISTER_LIMITER")
    expect(route).toContain("PRIV004_POLICY_NOT_ADMISSIBLE")
    expect(route).toContain("PRIV004_POLICY_OUTSIDE_WINDOW")
    expect(route).toContain("AUTH-001.response-digest.v1")
  })
