import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('account authentication page styles', () => {
  it('provides Tailwind utilities without importing global Preflight', () => {
    const styles = read('src/styles/account-auth.css')

    expect(styles).toContain('@tailwind utilities;')
    expect(styles).not.toContain('@tailwind base;')
    expect(styles).toContain('--main-background: 255 255 255')
    expect(styles).toContain('--main-accent: 37 99 235')
    expect(styles).toContain('.lr-account-auth-page')
    expect(styles).toContain('html.frontend-legacy-root .lr-account-auth-page a.text-main-accent')
  })

  it('loads the scoped style entry on all frontend account-entry pages', () => {
    const routes = [
      'src/app/(frontend)/forgot-password/page.tsx',
      'src/app/(frontend)/reset-password/page.tsx',
      'src/app/(frontend)/verify-email/page.tsx',
      'src/app/(frontend)/register/page.tsx',
    ]

    for (const path of routes) {
      expect(read(path)).toContain("import '../../../styles/account-auth.css'")
    }

    for (const path of routes.slice(0, 3)) {
      expect(read(path)).toContain('className="lr-account-auth-page')
    }

    const registerForm = read('src/app/(frontend)/register/RegisterForm.tsx')
    expect(registerForm).toContain('className="lr-account-auth-page min-h-screen bg-main-background')
  })

  it('keeps the existing login route on its own Twitter-clone style entry', () => {
    const loginLayout = read('src/app/(twitter-clone)/layout.tsx')

    expect(loginLayout).toContain("import '../../styles/twitter-clone-globals.scss'")
  })
})
