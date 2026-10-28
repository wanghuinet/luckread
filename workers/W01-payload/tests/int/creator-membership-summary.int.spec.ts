import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const membershipSummaryRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/v1/membership/creator-summary/route.ts'),
  'utf8',
)
const membershipInsights = readFileSync(
  resolve(process.cwd(), 'src/app/(frontend)/creator-center/CreatorMembershipInsights.tsx'),
  'utf8',
)
const creatorStudio = readFileSync(
  resolve(process.cwd(), 'src/app/(frontend)/creator-center/CreatorStudio.tsx'),
  'utf8',
)
const w07Summary = readFileSync(
  resolve(process.cwd(), '../../workers/W07-subscription-commerce/src/subscription-runtime.ts'),
  'utf8',
)

describe('creator membership insights adapter contract', () => {
  it('requires the dedicated W08 creator-owned permission before invoking W07', () => {
    expect(membershipSummaryRoute).toContain("'membership.analytics.read.own'")
    expect(membershipSummaryRoute).toContain("resourceType: 'MembershipPlan'")
    expect(membershipSummaryRoute).toContain('resourceAttributes: { ownerId: principalUserId }')
    expect(membershipSummaryRoute.indexOf('authorizeMembershipAnalytics(request, principal.userId)'))
      .toBeLessThan(membershipSummaryRoute.indexOf('callW07Subscription({'))
    expect(membershipSummaryRoute).toContain("callW08Creator(request, '/internal/creator/self', 'GET')")
    expect(membershipSummaryRoute).toContain("pathname: '/membership/creator-summary'")
    expect(membershipSummaryRoute).toContain('verifiedCreatorId: creatorId')
  })

  it('validates the complete aggregate response and keeps the route non-cacheable', () => {
    expect(membershipSummaryRoute).toContain('function isSummary(value: unknown)')
    expect(membershipSummaryRoute).toContain("headers: { 'cache-control': 'no-store' }")
    expect(membershipSummaryRoute).toContain("errorResponse(503, 'INVALID_SUMMARY_RESPONSE'")
    expect(membershipSummaryRoute).not.toContain('subscriberId:')
    expect(membershipSummaryRoute).not.toContain('revenueMinor:')
  })

  it('reads counts only from creator-scoped authoritative W07 D1-01 membership records', () => {
    expect(w07Summary).toContain("FROM membership_plans WHERE owner_type = 'CREATOR' AND owner_id = ?")
    expect(w07Summary).toContain('FROM membership_subscriptions WHERE creator_id = ?')
    expect(w07Summary).toContain('COUNT(DISTINCT CASE WHEN status = \'ACTIVE\' THEN subscriber_id END) AS activeSubscribers')
    expect(w07Summary).toContain("throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)")
  })

  it('renders live membership counts and explicitly refuses to estimate creator earnings', () => {
    expect(creatorStudio).toContain("import CreatorMembershipInsights from './CreatorMembershipInsights'")
    expect(creatorStudio).toContain('<CreatorMembershipInsights locale={locale} />')
    expect(membershipInsights).toContain("'/api/v1/membership/creator-summary'")
    expect(membershipInsights).toContain('paid checkout stays')
      .toBeDefined()
    expect(membershipInsights).toContain('Earnings are intentionally unavailable')
    expect(membershipInsights).toContain('收益数据暂不可用')
    expect(membershipInsights).not.toContain('priceMinor: summary.subscriptions')
  })
})
