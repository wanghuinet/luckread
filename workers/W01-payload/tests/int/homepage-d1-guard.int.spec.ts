import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('homepage D1 guard', () => {
  it('does not use Payload/native auth for anonymous homepage requests', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/page.tsx'), 'utf8')
    expect(page).toContain('getBetterAuthPrincipal')
    expect(page).toContain('enforcePublicReadRateLimit')
    expect(page).not.toContain('payload.auth(')
    expect(page).not.toContain('payload-token')
    expect(page).not.toContain('readVerifiedPayloadTokenVersion')
    expect(page).not.toContain('validateSession(')
  })
})
