import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('W03 canonical principal boundary', () => {
  it('uses W02 Better Auth principal resolution instead of local Payload session validation', () => {
    const source = read('src/content/w03-content-client.ts')

    expect(source).toContain("from '../auth/w02-principal-client.js'")
    expect(source).toContain('resolveCanonicalPrincipal(request)')
    expect(source).not.toContain("from 'payload'")
    expect(source).not.toContain("payload-access-token")
    expect(source).not.toContain("w02-session-client")
    expect(source).not.toContain('payload.auth')
  })

  it('accepts the canonical auth transports without inspecting Payload tokens locally', () => {
    const source = read('src/auth/w02-principal-client.ts')

    expect(source).toContain("new Headers(request.headers)")
    expect(source).toContain("headers.delete('host')")
    expect(source).toContain("headers.delete('content-length')")
    expect(source).toContain('/internal/auth/principal')
  })
})
