import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Better Auth password change boundary', () => {
  it('keeps the versioned route thin', () => {
    const route = read('src/app/api/v1/auth/password/change/route.ts')
    expect(route).toContain("export { POST } from '../../../../../auth/password/change/route'")
    expect(route).not.toContain('getPayload(')
  })

  it('delegates password change to Better Auth', () => {
    const route = read('src/app/auth/password/change/route.ts')
    expect(route).toContain("proxyBetterAuth")
    expect(route).toContain("'/change-password'")
    expect(route).toMatch(/revokeOtherSessions:true/)
    expect(route).not.toContain('payload.login(')
    expect(route).not.toContain('payload.update(')
  })
})
