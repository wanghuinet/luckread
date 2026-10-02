import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned auth refresh adapter', () => {
  it('exposes the existing refresh handler under /api/v1/auth/refresh', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/auth/refresh/route.ts'),
      'utf8',
    )

    expect(route).toContain("export { POST } from '../../../../auth/refresh/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('refreshSession(')
    expect(route).not.toContain('issuePayloadAccessToken(')
  })
})
