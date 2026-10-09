import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Register form status accessibility', () => {
  it('exposes busy submission and polite success status', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/register/RegisterForm.tsx'), 'utf8')

    expect(source).toContain('<div className="registerSuccess" role="status" aria-live="polite">')
    expect(source).toContain('aria-busy={status === \'submitting\'}')
    expect(source).toContain("disabled={status === 'submitting'}")
    expect(source).toContain('<p className="registerError" role="alert">')
  })

  it('aligns password validation with the W02 Better Auth policy', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/register/RegisterForm.tsx'), 'utf8')
    expect(source).toContain('password.length < 15 || password.length > 128')
    expect(source).toContain('minLength={15}')
    expect(source).toContain('maxLength={128}')
    expect(source).toContain('密码长度必须为 15–128 位。')
  })

  it('validates email format before sending registration to W02', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/register/RegisterForm.tsx'), 'utf8')
    expect(source).toContain('normalizedEmail.length > 254')
    expect(source).toContain('请输入有效的邮箱地址。')
  })
})
