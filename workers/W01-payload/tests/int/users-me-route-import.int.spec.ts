import { describe, expect, it } from 'vitest'
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
  it('short-circuits credential-free GET/PATCH before Payload authentication', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'),
      'utf8',
    )

    expect(source).toContain("import { readPayloadAccessToken, readVerifiedPayloadTokenVersion } from '@/auth/payload-access-token'")
    expect(source).toContain('if (!readPayloadAccessToken(request)) return unauthorized()')
    const credentialCheck = source.indexOf('if (!readPayloadAccessToken(request)) return unauthorized()')
    const payloadInit = source.indexOf('const payload = await getPayload({ config })')
    expect(credentialCheck).toBeGreaterThan(-1)
    expect(payloadInit).toBeGreaterThan(credentialCheck)
    expect(source.indexOf('if (!readPayloadAccessToken(request)) return unauthorized()', credentialCheck + 1)).toBeGreaterThan(payloadInit)
  })

})