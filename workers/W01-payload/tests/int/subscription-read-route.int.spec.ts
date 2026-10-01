import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('subscription read public boundary', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/app/(payload)/api/v1/memberships/subscriptions/[subscriptionId]/route.ts'),
    'utf8',
  )

  it('uses the canonical authenticated principal and W07 membership boundary', () => {
    expect(source).toContain("from '@/content/w03-content-client'")
    expect(source).toContain("from '@/membership/w07-membership-client'")
    expect(source).toContain('resolveContentPrincipal(request)')
    expect(source).toContain('MIN_MEMBERSHIP_READ_LAYER = 2')
    expect(source).toContain("readMembershipSubscription({")
    expect(source).not.toContain('D1')
    expect(source).not.toContain('accountState')
  })

  it('does not expose client-supplied subscriber identity', () => {
    expect(source).not.toContain('searchParams.get')
    expect(source).not.toContain('subscriberId:')
  })
})
