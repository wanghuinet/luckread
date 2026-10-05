import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('versioned auth password reset adapters', () => {
  it('delegates reset request to the existing native handler', () => {
    const route = read('src/app/api/v1/auth/password/reset/request/route.ts')
    expect(route).toContain("export { POST } from '../../../../../../auth/password/reset/request/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('forgotPassword(')
  })

  it('delegates reset confirmation to the existing native handler', () => {
    const route = read('src/app/api/v1/auth/password/reset/confirm/route.ts')
    expect(route).toContain("export { POST } from '../../../../../../auth/password/reset/confirm/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('resetPassword(')
  })
})
