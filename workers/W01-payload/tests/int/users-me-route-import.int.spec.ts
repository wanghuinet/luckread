import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('users/me route auth boundary', () => {
  it('uses W02 Better Auth principal and not Payload/native session auth', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
    expect(source).toContain("from '@/auth/w02-session-client'")
    expect(source).toContain('getBetterAuthPrincipal')
    expect(source).not.toContain("from '@/auth/payload-access-token'")
    expect(source).not.toContain('readPayloadAccessToken')
    expect(source).not.toContain('readVerifiedPayloadTokenVersion')
    expect(source).not.toContain('validateSession')
    expect(source).not.toContain('payload.auth(')
  })

  it('keeps authenticated self-profile GET/PATCH protections', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
    expect(source).toContain('export async function GET')
    expect(source).toContain('export async function PATCH')
    expect(source).toContain("if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED'")
    expect(source).toContain("if (normalizeEtag(ifMatch) !== normalizeEtag(currentEtag))")
    expect(source).toContain('PROFILE_MUTABLE_FIELDS')
    expect(source).toContain('where:')
    expect(source).toContain("{ updatedAt: { equals: current.updatedAt } }")
    expect(source).not.toContain('data: input')
  })
})
