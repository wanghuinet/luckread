import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('login frontend', () => {
  it('uses the versioned login API surface', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(frontend)/login/LoginForm.tsx'),
      'utf8',
    )

    expect(page).toContain("fetch('/api/v1/auth/login'")
    expect(page).not.toContain("fetch('/auth/login'")
    expect(page).not.toContain('deviceId')
    expect(page).toContain("router.push(returnTo)")
  })
})
