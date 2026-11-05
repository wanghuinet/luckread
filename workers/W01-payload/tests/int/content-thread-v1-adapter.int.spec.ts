import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('native social post thread W01 adapter', () => {
  it('keeps thread reads on the canonical W01 -> W03 content route with public cache separation', () => {
    const route = read('src/app/api/v1/contents/[contentId]/thread/route.ts')
    expect(route).toContain('hasAuthenticatedSessionCredential')
    expect(route).toContain('resolveCookieContentPrincipal')
    expect(route).toContain('callW03Content')
    expect(route).toContain('const threadPath = (contentId: string) =>')
    expect(route).toContain("'/internal/content/contents/' + encodeURIComponent(contentId) + '/thread'")
    expect(route).toContain("cachedPublicGet(")
    expect(route).toContain("'content-relationships'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('D1_02')
  })

  it('requires W02-authenticated identity and Idempotency-Key before linking thread posts', () => {
    const route = read('src/app/api/v1/contents/[contentId]/thread/route.ts')
    expect(route).toContain('resolveCookieContentPrincipal(request)')
    expect(route).toContain("request.headers.get('Idempotency-Key')")
    expect(route).toContain("method: 'POST'")
    expect(route).toContain('nextContentId')
    expect(route).toContain('invalidatePublicContentRelationships(contentId)')
    expect(route).toContain('invalidatePublicContentRelationships(nextContentId)')
  })
})
