import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('W02-authoritative username change API', () => {
  it('exposes only the W01 versioned self-service adapter', () => {
    const adapter = read('src/app/api/v1/users/me/username/route.ts')
    expect(adapter).toContain("export { GET, PATCH } from '../../../../../(payload)/api/users/me/username/route'")
  })

  it('reads and mutates username state through the existing W01 to W02 Service Binding', () => {
    const route = read('src/app/(payload)/api/users/me/username/route.ts')
    expect(route).toContain("callW02('/internal/auth/username/state'")
    expect(route).toContain("callW02('/internal/auth/username/change'")
    expect(route).toContain("'X-LuckRead-Caller': 'W01'")
    expect(route).toContain("'Idempotency-Key': idempotencyKey")
    expect(route).toContain("'If-Match': ifMatch")
    expect(route).toContain('principal.userId')
  })

  it('updates only the W01 Payload projection after W02 commits and invalidates old/new profile keys', () => {
    const route = read('src/app/(payload)/api/users/me/username/route.ts')
    expect(route).toContain("where: { identityId: { equals: principal.userId } }")
    expect(route).toContain("collection: 'users'")
    expect(route).toContain("data: { username: changedUsername }")
    expect(route).toContain('invalidatePublicUserProfileByUsername')
    expect(route).toContain('PROFILE_PROJECTION_PENDING')
  })
})
