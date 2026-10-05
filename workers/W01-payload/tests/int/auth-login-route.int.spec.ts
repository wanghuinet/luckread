import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = () => readFileSync(resolve(process.cwd(), 'src/app/auth/login/route.ts'), 'utf8')

describe('Better Auth login boundary', () => {
  it('delegates login to the Better Auth email sign-in endpoint', () => {
    const source = read()
    expect(source).toContain("proxyBetterAuth")
    expect(source).toContain("'/sign-in/email'")
    expect(source).toMatch(/proxyBetterAuthOperation\(request,\s*['"]\/sign-in\/email['"]\s*,\s*['"]POST['"]/) 
    expect(source).toMatch(/email:body\.identity\.trim\(\)\.toLowerCase\(\)/)
    expect(source).toMatch(/password:body\.credential/)
    expect(source).not.toContain('getPayload(')
    expect(source).not.toContain('establishSession(')
    expect(source).not.toContain('issuePayloadAccessToken(')
  })
})
