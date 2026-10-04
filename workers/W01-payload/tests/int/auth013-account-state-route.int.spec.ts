import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('AUTH-013 W01 account-state boundary', () => {
  it('authenticates with Better Auth and delegates only the state transition to W02', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/users/[userId]/account-state/route.ts'), 'utf8')
    expect(route).toContain('getBetterAuthSession')
    expect(route).toContain('transitionAccountState')
    expect(route).not.toContain('readVerifiedPayloadTokenVersion')
    expect(route).not.toContain('validateSession')
    expect(route).not.toContain('tokenVersion')
  })
})
