import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned users/me adapter', () => {
  it('exposes the existing self-profile handler under /api/v1/users/me', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/users/me/route.ts'),
      'utf8',
    )

    expect(route).toContain("export { GET, PATCH } from '../../../../(payload)/api/users/me/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('validateSession(')
    expect(route).not.toContain('PROFILE_MUTABLE_FIELDS')
  })
})
