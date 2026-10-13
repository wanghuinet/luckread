import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('standalone email verification page', () => {
  it('posts a normalized email to the rate-limited v1 resend endpoint', () => {
    const form = readFileSync(
      resolve(process.cwd(), 'src/app/(frontend)/verify-email/VerifyEmailForm.tsx'),
      'utf8',
    )

    expect(form).toContain("'/api/v1/auth/verification/send'")
    expect(form).toContain('body: JSON.stringify({ identity: normalizedEmail })')
    expect(form).toContain('normalizedEmail.length > 254')
    expect(form).toContain('.toLowerCase()')
    expect(form).toContain('系统已受理验证邮件请求')
    expect(form).toContain("status === 'sending'")
  })

  it('keeps a directly accessible path and links back to login and registration', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(frontend)/verify-email/page.tsx'),
      'utf8',
    )
    const login = readFileSync(
      resolve(process.cwd(), 'src/app/(frontend)/login/LoginForm.tsx'),
      'utf8',
    )

    expect(page).toContain('VerifyEmailForm')
    expect(page).toContain('href="/login"')
    expect(page).toContain('href="/register"')
    expect(login).toContain('href="/verify-email"')
  })
})
