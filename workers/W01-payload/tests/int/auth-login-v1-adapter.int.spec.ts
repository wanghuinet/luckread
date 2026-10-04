import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned auth login adapter', () => {
  it('keeps the v1 login route as a thin facade over the Better Auth-backed handler', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/auth/login/route.ts'), 'utf8')
    expect(route).toContain("export { POST } from '../../../../auth/login/route'")
    const login = readFileSync(resolve(process.cwd(), 'src/app/auth/login/route.ts'), 'utf8')
    expect(login).toContain("proxyBetterAuth")
    expect(login).toContain("'/sign-in/email'")
  })
})
