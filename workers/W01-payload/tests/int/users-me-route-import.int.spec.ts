import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('users/me route imports', () => {
  it('uses the W01 path alias for auth dependencies', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
    expect(source).toContain("from '@/auth/payload-access-token'")
    expect(source).toContain("from '@/auth/w02-session-client'")
    expect(source).not.toContain("../../../../../auth/payload-access-token.js")
    expect(source).not.toContain("../../../../../auth/w02-session-client.js")
  })
})