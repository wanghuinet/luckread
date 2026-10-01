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
})
