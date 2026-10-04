import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('users/me route auth boundary', () => {
  it('uses Payload authentication backed by the Better Auth custom strategy', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
    expect(source).toContain('payload.auth(')
    expect(source).not.toContain('readPayloadAccessToken')
    expect(source).not.toContain('readVerifiedPayloadTokenVersion')
    expect(source).not.toContain('validateSession')
  })

  it('keeps the authenticated self-profile API contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
    expect(source).toContain('export async function GET')
    expect(source).toContain('export async function PATCH')
    expect(source).toContain("PROFILE_MUTABLE_FIELDS")
    expect(source).toContain("status: 428")
    expect(source).not.toContain('data: input')
  })
})
