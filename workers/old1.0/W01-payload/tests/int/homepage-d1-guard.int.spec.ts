import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('homepage D1 guard', () => {
  it('does not call Payload auth for anonymous creator-center homepage requests', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/page.tsx'), 'utf8')
    expect(page).toContain("const hasAuthCredential =")
    expect(page).toContain("const authorization = request.headers.get('authorization')?.trim() || ''")
    expect(page).toContain("authorization.startsWith('Bearer ')")
    expect(page).toContain("request.headers.get('cookie')?.split(';').some")
    expect(page).toContain("name === 'payload-token'")
    expect(page).toContain("if (hasAuthCredential) {")
    expect(page).toContain("await enforcePublicReadRateLimit(request)")
    expect(page).toContain("const authResult = await payload.auth({")
    expect(page).not.toContain("Boolean(request.headers.get('cookie')?.trim())")
  })
})
