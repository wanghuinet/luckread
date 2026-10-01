import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('subscription cancel public boundary', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/app/(payload)/api/v1/memberships/subscriptions/[subscriptionId]/cancel/route.ts'),
    'utf8',
  )

  it('requires authenticated L2, If-Match and Idempotency-Key before W07', () => {
    expect(source).toContain('resolveContentPrincipal(request)')
    expect(source).toContain('MIN_MEMBERSHIP_MUTATION_LAYER = 2')
    expect(source).toContain("request.headers.get('If-Match')")
    expect(source).toContain("request.headers.get('Idempotency-Key')")
    expect(source).toContain('match(/^(?:W\\/)?"([1-9]\\\\d{0,17})"$/)')
    expect(source).toContain('transitionMembershipSubscription({')
    expect(source).not.toContain('D1')
    expect(source).not.toContain('subscriberId:')
    expect(source).not.toContain('entitlementId:')
  })

  it('does not accept client lifecycle authority in the request body', () => {
    expect(source).not.toContain('request.json')
    expect(source).not.toContain('actor:')
    expect(source).not.toContain('entitlementAction:')
    expect(source).toContain("from: 'ACTIVE'")
    expect(source).toContain("to: 'CANCELED'")
  })
})
