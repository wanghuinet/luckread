import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 Following feed adapter', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/feed/following/route.ts'),
    'utf8',
  )
  const wrangler = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8')

  it('requires a cookie-backed server principal before calling W04', () => {
    expect(route).toContain('resolveCookieContentPrincipal(request)')
    expect(route).toContain('if (principal instanceof Response) return principal')
    expect(route).toContain("W04_FEED?: FeedServiceBinding")
    expect(route).toContain("'X-LuckRead-Caller': 'W01'")
    expect(route).toContain("'X-LuckRead-Principal-User-Id': principal.userId")
    expect(route).toContain('/internal/feed/following')
  })

  it('keeps Following responses private and rejects malformed pagination input', () => {
    expect(route).toContain("'cache-control': 'no-store'")
    expect(route).toContain("url.searchParams.getAll('cursor').length > 1")
    expect(route).toContain("url.searchParams.getAll('limit').length > 1")
    expect(route).toContain("cursor.length > 2048")
    expect(route).toContain("! /^(?:[1-9]|[1-4][0-9]|50)$/".replace('! ', '!'))
  })

  it('binds W01 to the existing W04 Worker without adding a database', () => {
    expect(wrangler).toContain('"binding": "W04_FEED"')
    expect(wrangler).toContain('"service": "luckread-w04"')
    expect(wrangler).not.toContain('"binding": "W04_FEED_DB"')
  })
})
