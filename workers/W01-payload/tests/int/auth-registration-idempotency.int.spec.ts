import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('AUTH-001 registration idempotency ordering', () => {
  it('reserves the idempotency key before creating a Better Auth identity', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/auth/register/route.ts'),
      'utf8',
    )

    const reservation = source.indexOf('INSERT INTO auth_registration_envelopes')
    const betterAuth = source.indexOf("proxyBetterAuth(request, '/sign-up/email'")
    expect(reservation).toBeGreaterThanOrEqual(0)
    expect(betterAuth).toBeGreaterThanOrEqual(0)
    expect(reservation).toBeLessThan(betterAuth)
  })

  it('releases an in-progress reservation on downstream registration failure', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/auth/register/route.ts'),
      'utf8',
    )

    expect(source).toContain('const releaseReservation = async')
    expect(source).toContain('await releaseReservation()')
    expect(source).toContain("event: 'auth.register.profile_projection_failure'")
    expect(source).toContain("return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')")
  })

  it('confirms that W02 returned a persisted identity before creating the Payload profile', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/auth/register/route.ts'),
      'utf8',
    )

    const identityLookup = source.indexOf('SELECT id, email, username FROM "user" WHERE id = ? LIMIT 1')
    const projectionWrite = source.indexOf('await payload.create({')
    expect(identityLookup).toBeGreaterThanOrEqual(0)
    expect(projectionWrite).toBeGreaterThanOrEqual(0)
    expect(identityLookup).toBeLessThan(projectionWrite)
    expect(source).toContain("event: 'auth.register.identity_not_persisted'")
    expect(source).toContain("return errorResponse(422, 'VALIDATION_FAILED', 'Registration could not be completed')")
    expect(source).toContain("env.D1.withSession('first-primary')")
  })

  it('validates email, username and password policy at the registration API boundary', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/auth/register/route.ts'),
      'utf8',
    )

    expect(source).toContain("'EMAIL_INVALID'")
    expect(source).toContain("'USERNAME_INVALID'")
    expect(source).toContain("'PASSWORD_LENGTH_INVALID'")
    expect(source).toContain("'USERNAME_TAKEN'")
    expect(source).toContain('/^[A-Za-z0-9]{6,32}$/.test(username.trim())')
    expect(source).toContain('credentialLength < 15 || credentialLength > 128')
  })

  it('preserves origin rejection semantics and logs a correlation identifier', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/auth/register/route.ts'),
      'utf8',
    )

    expect(source).toContain("authResponse.status === 403 || upstreamCode === 'INVALID_ORIGIN'")
    expect(source).toContain("errorResponse(403, 'INVALID_ORIGIN'")
    expect(source).toContain("cfRay: request.headers.get('cf-ray') ?? null")
  })
})
