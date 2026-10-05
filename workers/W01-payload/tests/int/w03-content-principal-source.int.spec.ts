import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('W03 canonical principal boundary', () => {
  it('uses W02 Better Auth principal resolution instead of local Payload session validation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/content/w03-content-client.ts'),
      'utf8',
    )

    expect(source).toContain("from '../auth/w02-principal-client.js'")
    expect(source).toContain('resolveCanonicalPrincipal(request)')
    expect(source).not.toContain("from 'payload'")
    expect(source).not.toContain("payload-access-token")
    expect(source).not.toContain("w02-session-client")
    expect(source).not.toContain('payload.auth')
  })

  it('treats either Authorization or cookie presence as a candidate session transport', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/content/w03-content-client.ts'),
      'utf8',
    )
    expect(source).toContain("request.headers.get('Authorization')")
    expect(source).toContain("request.headers.get('cookie')")
    expect(source).toContain('resolveContentPrincipal(request)')
  })
})
