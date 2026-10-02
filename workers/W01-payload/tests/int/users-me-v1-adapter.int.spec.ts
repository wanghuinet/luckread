import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('versioned current-user profile adapter', () => {
  it('exposes the existing /users/me handlers under the /api/v1 prefix', () => {
    const route = read('src/app/api/v1/users/me/route.ts')

    expect(route).toContain("export { GET, PATCH }")
    expect(route).toContain("../../../../(payload)/api/users/me/route")
  })

  it('keeps the adapter free of a second profile implementation', () => {
    const route = read('src/app/api/v1/users/me/route.ts')

    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('payload.update(')
    expect(route).not.toContain('PROFILE_MUTABLE_FIELDS')
  })
})
