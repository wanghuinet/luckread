import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 report adapter', () => {
  it('forwards report creation to the existing W06 moderation authority', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/reports/route.ts'),
      'utf8',
    )
    expect(route).toContain('callW06Moderation')
    expect(route).toContain("pathname: '/reports'")
    expect(route).toContain('resolveCookieContentPrincipal')
    expect(route).toContain('Idempotency-Key')
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('D1_03')
  })

  it('keeps the public payload aligned with the canonical report target model', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/reports/route.ts'),
      'utf8',
    )
    for (const targetType of ['content', 'comment', 'creator', 'media', 'profile']) {
      expect(route).toContain('targetType !== ' + JSON.stringify(targetType))
    }
    expect(route).toContain('targetId')
    expect(route).toContain('reasonCode')
    expect(route).toContain('evidenceRefs')
  })
})
