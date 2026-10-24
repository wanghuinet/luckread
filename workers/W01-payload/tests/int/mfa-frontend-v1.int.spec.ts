import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('W01 canonical MFA frontend integration', () => {
  it('routes password login MFA challenges to the app-owned second-factor screen', () => {
    const login = read('src/app/(frontend)/login/LoginForm.tsx')
    const loginRoute = read('src/app/auth/login/route.ts')

    expect(loginRoute).toContain('challengeRequired: true')
    expect(loginRoute).toContain('status: 202')
    expect(login).toContain('data?.data?.challengeRequired === true')
    expect(login).toContain("'/login/two-factor?returnTo='")
    expect(login).toContain("fetchJson<ApiError | null>('/api/v1/auth/login'")
    expect(login).not.toContain("fetch('/api/auth/sign-in/email'")
  })

  it('verifies sign-in TOTP or recovery codes only through the canonical W01 DTO endpoint', () => {
    const page = read('src/app/(frontend)/login/two-factor/page.tsx')

    expect(page).toContain("'/api/v1/auth/mfa/challenge/verify'")
    expect(page).toContain("'Idempotency-Key'")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("method: 'recovery_code'")
    expect(page).not.toContain("'/api/auth/two-factor/verify-totp'")
    expect(page).not.toContain("'/api/auth/two-factor/verify-backup-code'")
    expect(page).not.toContain('localStorage')
    expect(page).toContain('router.replace(safeReturnTo())')
  })

  it('enrolls MFA through W01 and never stores the TOTP secret or recovery codes persistently', () => {
    const page = read('src/app/(frontend)/login/mfa/page.tsx')

    expect(page).toContain("'/api/v1/auth/mfa/enrollment'")
    expect(page).toContain("'/api/v1/auth/mfa/enrollment/confirm'")
    expect(page).toContain("'Idempotency-Key'")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain('recoveryCodes.map')
    expect(page).toContain('setRecoveryCodes([])')
    expect(page).not.toContain('/api/auth/two-factor/enable')
    expect(page).not.toContain('/api/auth/two-factor/verify-totp')
    expect(page).not.toContain('localStorage')
    expect(page).not.toContain('sessionStorage')
  })
})
