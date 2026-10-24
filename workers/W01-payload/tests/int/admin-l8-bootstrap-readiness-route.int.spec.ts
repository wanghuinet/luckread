import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { POST } from '../../src/app/api/v1/admin/bootstrap/super-admin/readiness/route.js'

describe('W01 L8 bootstrap read-only readiness boundary', () => {
  it('rejects calls without the GitHub Actions identity bearer token', async () => {
    const response = await POST(new Request(
      'https://api.luckread.com/api/v1/admin/bootstrap/super-admin/readiness',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    ))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    })
  })

  it('rejects a token-only envelope before invoking the W02 service binding', async () => {
    const response = await POST(new Request(
      'https://api.luckread.com/api/v1/admin/bootstrap/super-admin/readiness',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + 'x'.repeat(200),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ requestPrNumber: 77 }),
      },
    ))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    })
  })

  it('forwards through the existing W02 binding and never writes from W01', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/admin/bootstrap/super-admin/readiness/route.ts'),
      'utf8',
    )
    expect(route).toContain("callW02('/internal/authz/bootstrap-super-admin/readiness'")
    expect(route).toContain("'X-LuckRead-Caller': 'W01'")
    expect(route).toContain("'X-LuckRead-Transport-Version': '1.0'")
    expect(route).not.toMatch(/D1_01|INSERT INTO|UPDATE\s+role_assignments|mfaVerified\s*:\s*true/)
  })
})
