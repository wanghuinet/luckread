import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('frontend session management', () => {
  it('reads the canonical session list and exposes the current session marker', () => {
    const page = read('src/app/(frontend)/me/sessions/page.tsx')
    const route = read('src/app/auth/sessions/[[...segments]]/route.ts')

    expect(page).toContain("fetch('/api/v1/auth/sessions?' + params.toString()")
    expect(page).toContain('currentSessionId')
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("cache: 'no-store'")
    expect(route).toContain('currentSessionId: String(session.session.id)')
    expect(route).toContain('currentSessionId: String(session.session.id)')
  })

  it('revokes only non-current sessions through the existing DELETE API with idempotency', () => {
    const page = read('src/app/(frontend)/me/sessions/page.tsx')

    expect(page).toContain("if (sessionId === currentSessionId || revokingId) return")
    expect(page).toContain("method: 'DELETE'")
    expect(page).toContain("'/api/v1/auth/sessions/'")
    expect(page).toContain("'Idempotency-Key': 'session-revoke-' + crypto.randomUUID()")
    expect(page).toContain("setSessions((current) => current.filter((item) => item.sessionId !== sessionId))")
    expect(page).toContain('退出设备')
  })

  it('preserves the full return path when the session list expires', () => {
    const page = read('src/app/(frontend)/me/sessions/page.tsx')
    expect(page).toContain("const returnTo = window.location.pathname + window.location.search + window.location.hash")
    expect(page).toContain("router.replace('/login?returnTo=' + encodeURIComponent(returnTo))")
  })

  it('preserves the full return path when revoking an expired session', () => {
    const page = read('src/app/(frontend)/me/sessions/page.tsx')
    expect(page).toContain("const returnTo = window.location.pathname + window.location.search + window.location.hash")
    expect(page).toContain("router.replace('/login?returnTo=' + encodeURIComponent(returnTo))")
  })

  it('links the profile security entry to the session management page', () => {
    const profile = read('src/app/(frontend)/me/profile/page.tsx')
    expect(profile).toContain('<Link href="/me/sessions">登录设备</Link>')
    expect(profile).toContain('<Link href="/me/subscriptions">我的订阅</Link>')
  })
})
