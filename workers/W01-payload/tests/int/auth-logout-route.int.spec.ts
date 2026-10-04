import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Better Auth logout boundary', () => {
  it('delegates logout to Better Auth and does not call W02 session revocation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/auth/logout/route.ts'), 'utf8')
    expect(source).toContain('proxyBetterAuth')
    expect(source).toContain("'/sign-out'")
    expect(source).not.toContain('revokeSession')
    expect(source).not.toContain('w02-session-client')
    expect(source).toContain('cache-control')
  })
})
