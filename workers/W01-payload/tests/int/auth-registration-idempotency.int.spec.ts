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

  it('records sanitized signals for upstream and registration-commit failures', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/auth/register/route.ts'),
      'utf8',
    )

    const rejectionEvent = source.indexOf("event: 'auth.register.better_auth_rejected'")
    const rejectionRelease = source.indexOf('await releaseReservation()', rejectionEvent)
    expect(rejectionEvent).toBeGreaterThanOrEqual(0)
    expect(rejectionRelease).toBeGreaterThan(rejectionEvent)

    const rejectionDiagnostic = source.slice(rejectionEvent, rejectionRelease)
    expect(rejectionDiagnostic).toContain('upstreamStatus: authResponse.status')
    expect(rejectionDiagnostic).toContain('...diagnostic')
    expect(source).toContain('const upstreamErrorCode =')
    expect(source).toContain('const failureCategory =')
    expect(rejectionDiagnostic).not.toContain('authPayload')
    expect(rejectionDiagnostic).not.toContain('normalized.credential')
    expect(source).toContain("event: 'auth.register.commit_conflict'")
    expect(source).toContain("'CONSENT_CONSTRAINT'")
  })
})
