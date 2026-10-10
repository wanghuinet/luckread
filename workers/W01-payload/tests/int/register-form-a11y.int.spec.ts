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
    expect(source).toContain('const passwordLength = password.length')
    expect(source).toContain('passwordLength < 15 || passwordLength > 128')
    expect(source).toContain('minLength={15}')
    expect(source).toContain('maxLength={128}')
    expect(source).toContain('密码长度必须为 15–128 个字符。')
  })

  it('validates email format before sending registration to W02', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/register/RegisterForm.tsx'), 'utf8')
    expect(source).toContain('normalizedEmail.length > 254')
    expect(source).toContain('邮箱格式不正确，请检查后重试。')
    expect(source).toContain('!/^[A-Za-z0-9]{6,32}$/.test(normalizedUsername)')
    expect(source).toContain('用户名需为 6–32 位英文字母或数字')
  })
})
