import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('login frontend', () => {
  it('uses the versioned login API surface', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(frontend)/login/LoginForm.tsx'),
      'utf8',
    )

    expect(page).toContain("fetchJson<ApiError | null>('/api/v1/auth/login'")
    expect(page).toContain("errorCode === 'EMAIL_NOT_VERIFIED'")
    expect(page).toContain("'/api/v1/auth/verification/send'")
    expect(page).toContain("get('verified') === '1'")
    expect(page).not.toContain("fetch('/auth/login'")
    expect(page).not.toContain('deviceId')
    expect(page).toContain("credentials: 'include'")
    expect(page).not.toContain('accessToken')
    expect(page).not.toContain('refreshToken')
    expect(page).toContain("router.push(returnTo)")
  })
})
