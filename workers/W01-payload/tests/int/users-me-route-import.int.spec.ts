import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('users/me authentication boundary', () => {
  const routePath = resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts')

  it('uses Payload custom authentication backed by Better Auth', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toContain('await payload.auth({')
    expect(source).not.toContain('payload-access-token')
    expect(source).not.toContain('w02-session-client')
    expect(source).not.toContain('validateSession(')
  })

  it('keeps authenticated self-profile GET/PATCH conditional and scoped', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toContain('export async function GET')
    expect(source).toContain('export async function PATCH')
    expect(source).toContain("if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED'")
    expect(source).toContain("if (normalizeEtag(ifMatch) !== normalizeEtag(currentEtag))")
    expect(source).toContain('PROFILE_MUTABLE_FIELDS')
    expect(source).toContain("{ updatedAt: { equals: current.updatedAt } }")
    expect(source).not.toContain('data: input')
  })
})
