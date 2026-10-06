import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('W02 Payload Admin authorization boundary', () => {
  it('resolves account state from the Better Auth user table', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8')
    const start = source.indexOf("url.pathname === '/internal/auth/admin/authorize'")
    const end = source.indexOf("url.pathname === '/internal/auth/session/establish'", start)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const handler = source.slice(start, end)
    expect(handler).toContain('FROM "user"')
    expect(handler).not.toContain('FROM users WHERE CAST(id AS TEXT) = ? LIMIT 1')
    expect(handler).toContain('account_state AS accountState')
  })
})
