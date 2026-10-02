import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned auth password change adapter', () => {
  it('exposes the existing password change handler without duplicating auth logic', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/auth/password/change/route.ts'),
      'utf8',
    )

    expect(route).toContain("export { POST } from '../../../../auth/password/change/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('payload.update(')
    expect(route).not.toContain('assertPasswordPolicy(')
  })
})
