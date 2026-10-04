import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Better Auth password reset adapters', () => {
  it('keeps reset request and confirmation as thin v1 facades', () => {
    const requestRoute = read('src/app/api/v1/auth/password/reset/request/route.ts')
    const confirmRoute = read('src/app/api/v1/auth/password/reset/confirm/route.ts')
    expect(requestRoute).toContain("export { POST } from '../../../../../../auth/password/reset/request/route'")
    expect(confirmRoute).toContain("export { POST } from '../../../../../../auth/password/reset/confirm/route'")
  })

  it('delegates both reset operations to Better Auth', () => {
    expect(read('src/app/auth/password/reset/request/route.ts')).toContain("'/request-password-reset'")
    expect(read('src/app/auth/password/reset/confirm/route.ts')).toContain("'/reset-password'")
  })
})
