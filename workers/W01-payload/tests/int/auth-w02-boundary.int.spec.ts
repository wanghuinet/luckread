import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('W01 → W02 Better Auth gateway boundary', () => {
  it('stamps the trusted W01 caller before proxying public Better Auth requests', () => {
    const route = read('src/app/api/auth/[...segments]/route.ts')
    expect(route).toContain("headers.set('X-LuckRead-Caller', 'W01')")
    expect(route).toContain("headers.delete('host')")
    expect(route).toContain("headers.delete('content-length')")
  })

  it('uses the trusted W01 caller for direct Better Auth sign-in transport', () => {
    const client = read('src/auth/w02-session-client.ts')
    expect(client).toContain("'X-LuckRead-Caller': 'W01'")
    expect(client).toContain("'https://luckread-w02.internal/api/auth/sign-in/email'")
  })

  it('keeps W02 Better Auth inaccessible without the W01 gateway marker', () => {
    const worker = read('../W02-identity/src/index.ts')
    expect(worker).toContain("request.headers.get('X-LuckRead-Caller') !== 'W01'")
    expect(worker).toContain("code: 'FORBIDDEN'")
    expect(worker).toContain("message: 'authentication gateway required'")
    expect(worker).toContain("url.pathname.startsWith('/internal/account/')")
    expect(worker).toContain("url.pathname.startsWith('/internal/authz/')")
    expect(worker).toContain("message: 'internal worker transport required'")
  })
})

