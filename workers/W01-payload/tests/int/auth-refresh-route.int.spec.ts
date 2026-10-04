import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Better Auth refresh compatibility boundary', () => {
  it('uses Better Auth session state instead of a second refresh-token engine', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/auth/refresh/route.ts'), 'utf8')
    expect(source).toContain("proxyBetterAuth")
    expect(source).toContain("'/get-session'")
    expect(source).not.toContain('refreshSession(')
    expect(source).not.toContain('issuePayloadAccessToken(')
    expect(source).not.toContain('refreshToken:')
  })
})
