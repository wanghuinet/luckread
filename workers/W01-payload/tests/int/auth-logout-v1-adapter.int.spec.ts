import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned auth logout adapter', () => {
  it('exposes the existing logout handler under /api/v1/auth/logout', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/auth/logout/route.ts'),
      'utf8',
    )

    expect(route).toContain("export { POST } from '../../../../auth/logout/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('revoke')
    expect(route).not.toContain('D1')
  })
})
