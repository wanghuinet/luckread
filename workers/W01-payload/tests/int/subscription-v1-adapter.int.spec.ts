import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 subscription adapter', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/memberships/subscriptions/[[...segments]]/route.ts'), 'utf8')
  const client = readFileSync(resolve(process.cwd(), 'src/subscription/w07-subscription-client.ts'), 'utf8')
  const wrangler = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8')

  it('binds W01 to the canonical W07 subscription authority', () => {
    expect(wrangler).toContain('W07_SUBSCRIPTION')
    expect(wrangler).toContain('luckread-w07')
    expect(client).toContain('W07_SUBSCRIPTION')
  })

  it('uses the cookie-backed principal and internal service transport', () => {
    expect(client).toContain('resolveCookieContentPrincipal')
    expect(client).toContain("X-LuckRead-Caller': 'W01'")
    expect(client).toContain("X-LuckRead-Transport-Version': '1.0'")
    expect(client).toContain('X-LuckRead-Principal-User-Id')
    expect(client).toContain('Idempotency-Key')
    expect(client).toContain('If-Match')
    expect(route).toContain('callW07Subscription')
  })

  it('exposes only the canonical subscription lifecycle paths', () => {
    expect(route).toContain("/memberships/subscriptions")
    expect(route).toContain("parts.length === 0 && method === 'GET'")
    expect(route).toContain("['cancel', 'pause', 'resume']")
    expect(route).toContain("'change-plan'")
    expect(route).not.toContain('entitlement')
  })
})
