import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned auth sessions adapter', () => {
  it('exposes the existing session management handler under /api/v1/auth/sessions', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/auth/sessions/[[...segments]]/route.ts'),
      'utf8',
    )

    expect(route).toContain(
      "export { GET, DELETE } from '../../../../../auth/sessions/[[...segments]]/route'",
    )
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('listSessions(')
    expect(route).not.toContain('revokeOwnedSession(')
  })
})
