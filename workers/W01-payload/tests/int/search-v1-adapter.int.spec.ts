import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public search v1 adapter', () => {
  it('validates the public query at W01 and keeps search responses out of shared cache', () => {
    const route = read('src/app/api/v1/search/route.ts')
    expect(route).toContain("new Set(['q', 'cursor', 'limit'])")
    expect(route).toContain('qValues.length !== 1')
    expect(route).toContain('cursorValues.length > 1')
    expect(route).toContain('limitValues.length > 1')
    expect(route).toContain('query.length > 256')
    expect(route).toContain('enforcePublicReadRateLimit(request)')
    expect(route).toContain('callW04ContentSearch')
    expect(route).not.toContain('cachedPublicGet')
  })

  it('routes through the existing W04 service binding with credentials stripped', () => {
    const client = read('src/feed/w04-feed-client.ts')
    const bindings = read('wrangler.jsonc')
    const w04 = read('../W04-feed-search/src/index.ts')
    const w03 = read('../W03-content/src/index.ts')
    expect(client).toContain('export async function callW04ContentSearch')
    expect(client).toContain("new Request('https://luckread-w04.internal' + input.pathname")
    expect(client).toContain("'X-LuckRead-Caller': 'W01'")
    expect(client).toContain("'X-LuckRead-Rate-Key'")
    expect(client).not.toContain("headers.set('Authorization'")
    expect(bindings).toContain('"binding": "W04_FEED"')
    expect(w04).toContain("'/internal/search/contents'")
    expect(w04).toContain("internal/content/search")
    expect(w03).toContain("url.pathname === '/internal/content/search'")
    expect(w03).toContain("request.headers.get('X-LuckRead-Caller') !== 'W04'")
    const searchHandler = w03.slice(
      w03.indexOf("url.pathname === '/internal/content/search'"),
      w03.indexOf('const isModerationTransition'),
    )
    expect(searchHandler).not.toContain('bodyRef: item.bodyRef')
    expect(searchHandler).not.toContain('mediaRefs: item.mediaRefs')
    expect(searchHandler).not.toContain('coverRef: item.coverRef')
  })

  it('limits public search to published title/slug metadata and preserves no-store responses', () => {
    const w03Runtime = read('../W03-content/src/content-runtime.ts')
    const w01Client = read('src/feed/w04-feed-client.ts')
    expect(w03Runtime).toContain("WHERE state = 'PUBLISHED'")
    expect(w03Runtime).toContain('published-content-search')
    expect(w01Client).toContain("'cache-control': 'no-store'")
  })
})
