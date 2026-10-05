import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('versioned auth login adapter', () => {
  it('exposes the existing login handler under /api/v1/auth/login', () => {
    const route = read('src/app/api/v1/auth/login/route.ts')

    expect(route).toContain("export { POST } from '../../../../auth/login/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('establishSession(')
    expect(route).not.toContain('issuePayloadAccessToken(')
  })
})
