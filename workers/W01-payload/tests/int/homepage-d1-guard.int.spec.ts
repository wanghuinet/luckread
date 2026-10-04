import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('homepage D1/auth guard', () => {
  it('does not use the legacy Payload token parser or W02 session validator', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/page.tsx'), 'utf8')
    expect(page).toContain("getBetterAuthSession")
    expect(page).toContain("if (CREATOR_CENTER_HOSTS.has(host))")
    expect(page).not.toContain('payload-token')
    expect(page).not.toContain('readVerifiedPayloadTokenVersion')
    expect(page).not.toContain('validateSession')
  })
})
