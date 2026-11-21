import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned auth register adapter', () => {
  it('exposes the existing registration handler under /api/v1/auth/register', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/auth/register/route.ts'),
      'utf8',
    )

    expect(route).toContain("export { POST } from '../../../../auth/register/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('auth_registration_envelopes')
    expect(route).not.toContain('validatePolicy(')
  })
})
