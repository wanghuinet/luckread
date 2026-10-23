import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolvePublicApiRequestUrl } from '../../src/lib/client-api.js'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('canonical public API domain routing', () => {
  it('maps the public /v1 surface onto W01 existing /api/v1 route handlers', () => {
    const config = read('next.config.ts')
    const openapi = read('../../contracts/openapi/v1/openapi.yaml')
    const inventory = read('../../contracts/alignment/api-inventory.v1.json')
    const authContract = read('../../docs/api/APP-AUTH-01-session-contract-v1.0.md')
    const appClient = read('../../app/lib/api-client.ts')

    expect(config).toContain("source: '/v1/:path*'")
    expect(config).toContain("value: 'api.luckread.com'")
    expect(config).toContain("destination: '/api/v1/:path*'")
    expect(openapi).toContain('url: https://api.luckread.com/v1')
    expect(inventory).toContain('"serverPrefix": "https://api.luckread.com/v1"')
    expect(authContract).toContain('POST /v1/auth/login')
    expect(authContract).toContain('GET /v1/auth/session')
    expect(authContract).not.toContain('POST /api/v1/auth/login')
    expect(appClient).toContain("const DEFAULT_API_BASE_URL = 'https://api.luckread.com'")
    expect(appClient).toContain("getApiBaseUrl() + '/v1' + normalizedPath")
  })

  it('allows credentialed CORS only from the known LuckRead browser hosts', () => {
    const config = read('next.config.ts')
    const auth = read('../W02-identity/src/auth/better-auth.ts')

    for (const origin of [
      'https://luckread.com',
      'https://www.luckread.com',
      'https://mp.luckread.com',
      'https://sso.luckread.com',
    ]) {
      expect(config).toContain("value: '" + origin + "'")
      expect(config).toContain("headers: corsHeaders('" + origin + "')")
    }

    expect(config).toContain("key: 'Access-Control-Allow-Credentials', value: 'true'")
    expect(config).toContain("key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS'")
    expect(config).not.toContain("key: 'Access-Control-Allow-Origin', value: '*'")
    expect(auth).toContain('crossSubDomainCookies: {')
    expect(auth).toContain("domain: '.luckread.com'")
  })

  it('converts production browser API calls without changing local/staging same-origin calls', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

    try {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
          location: {
            hostname: 'luckread.com',
            origin: 'https://luckread.com',
          },
        } as unknown as Window,
      })

      expect(resolvePublicApiRequestUrl('/api/v1/contents?limit=20'))
        .toBe('https://api.luckread.com/v1/contents?limit=20')
      expect(resolvePublicApiRequestUrl('/login')).toBe('/login')

      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
          location: {
            hostname: 'localhost',
            origin: 'http://localhost:3000',
          },
        } as unknown as Window,
      })
      expect(resolvePublicApiRequestUrl('/api/v1/contents')).toBe('/api/v1/contents')
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })

  it('blocks private domain Worker client imports from UI code, including W11 analytics', () => {
    const scanner = read('../../scripts/verify-three-client-development-contract.mjs')
    expect(scanner).toContain('private domain Worker client imported directly from UI')
    expect(scanner).toContain('w11-analytics-client')
    expect(scanner).toContain('w02-session-client')
    expect(scanner).toContain('w08-creator-client')
  })

  it('keeps generated share links on the public website, not on the API hostname', () => {
    const share = read('../../app/lib/content-share.ts')
    expect(share).toContain("const PUBLIC_SHARE_ORIGIN = 'https://luckread.com'")
    expect(share).toContain("PUBLIC_SHARE_ORIGIN + '/s/'")
    expect(share).not.toContain("PUBLIC_SHARE_ORIGIN = 'https://api.luckread.com'")
  })
})
