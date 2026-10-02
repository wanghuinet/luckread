import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('users/me route imports', () => {
  it('uses the W01 path alias for auth dependencies', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
    expect(source).toContain("from '@/auth/payload-access-token'")
    expect(source).toContain("from '@/auth/w02-session-client'")
    expect(source).not.toContain("../../../../../auth/payload-access-token.js")
    expect(source).not.toContain("../../../../../auth/w02-session-client.js")
  })

  it('exposes authenticated self-profile GET/PATCH with conditional writes and no mass assignment', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'),
      'utf8',
    )

    expect(source).toContain('export async function GET')
    expect(source).toContain('export async function PATCH')
    expect(source).toContain("if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED'")
    expect(source).toContain("if (normalizeEtag(ifMatch) !== normalizeEtag(currentEtag))")
    expect(source).toContain('PROFILE_MUTABLE_FIELDS')
    expect(source).toContain('where:')
    expect(source).toContain("{ updatedAt: { equals: current.updatedAt } }")
    expect(source).not.toContain('data: input')
  })

  it('keeps locale and timezone on the authenticated self-profile surface', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'),
      'utf8',
    )
    const fields = readFileSync(
      resolve(process.cwd(), 'src/auth/user-profile-etag.ts'),
      'utf8',
    )
    const users = readFileSync(
      resolve(process.cwd(), 'src/collections/Users.ts'),
      'utf8',
    )

    expect(route).toContain('pickUserProfileSnapshot(user)')
    expect(fields).toContain("  'locale',")
    expect(fields).toContain("  'timezone',")
    expect(fields).toContain("locale: typeof user.locale === 'string' ? user.locale : null")
    expect(fields).toContain("timezone: typeof user.timezone === 'string' ? user.timezone : null")
    expect(users).toContain("name: 'locale'")
    expect(users).toContain("defaultValue: 'en-US'")
    expect(users).toContain("name: 'timezone'")
    expect(users).toContain("defaultValue: 'UTC'")
  })

  it('prints the checked PR diff stat for reproducible CI evidence', () => {
    const stat = execFileSync('git', ['diff', '--stat', 'HEAD^1', 'HEAD'], {
      encoding: 'utf8',
    }).trim()

    expect(stat).toContain('workers/W01-payload/tests/int/users-me-route-import.int.spec.ts')
    console.log('===== git diff --stat HEAD^1 HEAD =====')
    console.log(stat)
  })

})
