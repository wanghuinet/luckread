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
    expect(route).toContain('callW03Content')
    expect(route).toContain("targetType === 'content'")
    expect(route).toContain("targetData?.id !== targetId || targetData.state !== 'PUBLISHED'")
    expect(route).toContain("pathname: '/reports'")
    expect(route).toContain('resolveCookieContentPrincipal')
    expect(route).toContain('Idempotency-Key')
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('D1_03')
  })

  it('enforces canonical report field bounds before forwarding', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/reports/route.ts'),
      'utf8',
    )
    expect(route).toContain('targetId.length > 128')
    expect(route).toContain('reasonCode.length > 128')
    expect(route).toContain('description.length > 4000')
    expect(route).toContain('evidenceRefs.length > 20')
    expect(route).toContain('value.length > 512')
  })

  it('keeps the public payload aligned with the canonical report target model', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/reports/route.ts'),
      'utf8',
    )
    expect(route).toContain("(targetType !== 'content' && targetType !== 'comment' && targetType !== 'creator' && targetType !== 'media' && targetType !== 'profile')")
    expect(route).toContain('targetId')
    expect(route).toContain('reasonCode')
    expect(route).toContain('evidenceRefs')
  })
})
