import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned auth refresh adapter', () => {
  it('keeps the v1 refresh route as a thin Better Auth session facade', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/auth/refresh/route.ts'), 'utf8')
    expect(route).toContain("export { POST } from '../../../../auth/refresh/route'")
    const refresh = readFileSync(resolve(process.cwd(), 'src/app/auth/refresh/route.ts'), 'utf8')
    expect(refresh).toContain("proxyBetterAuth")
    expect(refresh).toContain("'/get-session'")
  })
})
