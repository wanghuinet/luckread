import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('password recovery frontend', () => {
  it('exposes the recovery request flow on the login surface', () => {
    const login = read('src/app/(frontend)/login/LoginForm.tsx')
    const page = read('src/app/(frontend)/forgot-password/page.tsx')

    expect(login).toContain('href="/forgot-password"')
    expect(page).toContain("fetchJson<{ error?: { message?: string } }>('/api/v1/auth/password/reset/request'")
    expect(page).toContain("method: 'POST'")
    expect(page).toContain('identifier')
    expect(page).toContain('如果该邮箱对应 LuckRead 账号')
  })

  it('submits password reset confirmation through the versioned recovery API', () => {
    const page = read('src/app/(frontend)/reset-password/page.tsx')

    expect(page).toContain("fetchJson<{ error?: { message?: string } }>('/api/v1/auth/password/reset/confirm'")
    expect(page).toContain("method: 'POST'")
    expect(page).toContain('recoveryToken')
    expect(page).toContain('newPassword')
    expect(page).toContain('MIN_PASSWORD_LENGTH = 15')
    expect(page).toContain('MAX_PASSWORD_LENGTH = 128')
    expect(page).toContain("const searchParams = useSearchParams()")
    expect(page).toContain("useState(searchParams.get('token') || '')")
    expect(page).toContain("window.history.replaceState(null, '', '/reset-password')")
  })
})
