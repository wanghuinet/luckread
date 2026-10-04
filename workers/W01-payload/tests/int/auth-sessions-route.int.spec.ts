import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Better Auth session management boundary', () => {
  it('uses Better Auth list/revoke APIs without W02 Session Engine coupling', () => {
    const route = read('src/app/auth/sessions/[[...segments]]/route.ts')
    expect(route).toContain('listBetterAuthSessions')
    expect(route).toContain('revokeBetterAuthSession')
    expect(route).toContain('getBetterAuthSession')
    expect(route).not.toContain('tokenVersion')
    expect(route).not.toContain('readVerifiedPayloadTokenVersion')
    expect(route).not.toContain('revokeOwnedSession')
    expect(route).not.toContain('listSessions(')
  })
})
