import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('password recovery frontend', () => {
  it('exposes the recovery request flow on the login surface', () => {
    const login = read('src/app/(frontend)/login/LoginForm.tsx')
    const page = read('src/app/(frontend)/forgot-password/page.tsx')

    expect(login).toContain('href="/forgot-password"')
    expect(page).toContain("fetchJson<{ error?: { code?: string; message?: string } }>('/api/v1/auth/password/reset/request'")
    expect(page).toContain("method: 'POST'")
    expect(page).toContain('identifier')
    expect(page).toContain('如果该邮箱对应 LuckRead 账号')
    expect(page).toContain('邮箱格式不正确，请检查拼写后重试。')
    expect(page).toContain('请求过于频繁，请稍等片刻后再试。')
    expect(page).toContain('密码找回邮件服务暂时不可用，请稍后重试。')
  })

  it('submits password reset confirmation through the versioned recovery API', () => {
    const page = read('src/app/(frontend)/reset-password/page.tsx')

    expect(page).toContain("fetchJson<{ error?: { code?: string; message?: string } }>('/api/v1/auth/password/reset/confirm'")
    expect(page).toContain("method: 'POST'")
    expect(page).toContain('recoveryToken')
    expect(page).toContain('newPassword')
    expect(page).toContain('MIN_PASSWORD_LENGTH = 15')
    expect(page).toContain('MAX_PASSWORD_LENGTH = 128')
    expect(page).toContain('重置链接无效、已过期或已使用。请重新申请密码找回邮件。')
    expect(page).toContain('新密码长度必须为 15–128 个字符。')
    expect(page).toContain("const searchParams = useSearchParams()")
    expect(page).toContain("useState(searchParams.get('token') || '')")
    expect(page).toContain("url.searchParams.delete('token')")
    expect(page).toContain("window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)")
    expect(page).toContain("window.history.replaceState(null, '', '/reset-password')")
  })

  it('rejects malformed JSON bodies safely at auth route boundaries', () => {
    const loginRoute = read('src/app/auth/login/route.ts')
    const requestRoute = read('src/app/auth/password/reset/request/route.ts')
    const confirmRoute = read('src/app/auth/password/reset/confirm/route.ts')

    for (const source of [loginRoute, requestRoute, confirmRoute]) {
      expect(source).toContain("if (!body || typeof body !== 'object' || Array.isArray(body))")
    }
    expect(loginRoute).toContain("'EMAIL_REQUIRED'")
    expect(loginRoute).toContain("'EMAIL_INVALID'")
    expect(loginRoute).toContain("'PASSWORD_REQUIRED'")
  })
})
