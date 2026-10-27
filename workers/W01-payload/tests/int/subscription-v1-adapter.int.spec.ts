import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const openapi = readFileSync(resolve(process.cwd(), '../../contracts/openapi/v1/openapi.yaml'), 'utf8')
const apiInventory = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/api/api-inventory.v1.json'), 'utf8'))

describe('v1 subscription adapter', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/memberships/subscriptions/[[...segments]]/route.ts'), 'utf8')
  const plansRoute = readFileSync(resolve(process.cwd(), 'src/app/api/v1/plans/route.ts'), 'utf8')
  const creatorPlansRoute = readFileSync(resolve(process.cwd(), 'src/app/api/v1/membership/plans/route.ts'), 'utf8')
  const w08CreatorClient = readFileSync(resolve(process.cwd(), 'src/auth/w08-creator-client.ts'), 'utf8')
  const w08Worker = readFileSync(resolve(process.cwd(), '../W08-creator/src/worker.ts'), 'utf8')
  const client = readFileSync(resolve(process.cwd(), 'src/subscription/w07-subscription-client.ts'), 'utf8')
  const wrangler = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8')

  it('routes plan discovery through W07 and keeps the existing inventory path', () => {
    expect(openapi).toContain('operationId: getPlans')
    expect(apiInventory.domains.subscription_entitlement_payment.endpoint_groups).toContain('GET /v1/plans')
    expect(plansRoute).toContain('resolveCookieSubscriptionPrincipal')
    expect(plansRoute).toContain("pathname: '/plans' + url.search")
    expect(plansRoute).toContain("method: 'GET'")
    expect(plansRoute).toContain('callW07Subscription')
    expect(plansRoute).not.toContain('export async function POST')
  })

  it('requires W08 CASL plus active creator identity before forwarding owner-scoped plan management', () => {
    expect(creatorPlansRoute).toContain("membership.plan.create.own")
    expect(creatorPlansRoute).toContain("membership.plan.read.own")
    expect(creatorPlansRoute).toContain("'/internal/authz/check-permission'")
    expect(creatorPlansRoute).toContain('(value as { data?: { decision?: unknown } }).data?.decision')
    expect(creatorPlansRoute).toContain("'/internal/creator/self'")
    expect(creatorPlansRoute).toContain('(value as { data?: { creatorId?: unknown } }).data?.creatorId')
    expect(w08Worker).toContain('return json({ creatorId: creator.creator_id, status: \'ACTIVE\' })')
    expect(creatorPlansRoute).toContain("verifiedCreatorId: creatorId")
    expect(w08CreatorClient).toContain("'/internal/creator/self'")
    expect(w08CreatorClient).toContain("'/internal/authz/check-permission'")
    expect(creatorPlansRoute).not.toContain('body.creatorId')
    expect(creatorPlansRoute).not.toContain('body.ownerId')
    expect(creatorPlansRoute).toContain('request.body.getReader()')
    expect(creatorPlansRoute).toContain('byteLength > 16_384')
    expect(creatorPlansRoute).toContain("new TextDecoder('utf-8', { fatal: true })")
    expect(creatorPlansRoute).not.toContain('await request.text()')
  })

  it('contracts creator plan permissions and server-controlled draft fields', () => {
    expect(openapi).toContain('operationId: listOwnMembershipPlans')
    expect(openapi).toContain('operationId: createOwnMembershipPlanDraft')
    expect(apiInventory.domains.subscription_entitlement_payment.endpoint_groups).toContain('GET /v1/membership/plans')
    expect(apiInventory.domains.subscription_entitlement_payment.endpoint_groups).toContain('POST /v1/membership/plans')
    expect(creatorPlansRoute).toContain("pathname: '/membership/plans' + url.search")
    expect(creatorPlansRoute).toContain("pathname: '/membership/plans'")
  })

  it('binds W01 to the canonical W07 subscription authority', () => {
    expect(wrangler).toContain('W07_SUBSCRIPTION')
    expect(wrangler).toContain('luckread-w07')
    expect(client).toContain('W07_SUBSCRIPTION')
  })

  it('uses the cookie-backed principal and internal service transport', () => {
    expect(client).toContain('resolveCookieContentPrincipal')
    expect(client).toContain("X-LuckRead-Caller': 'W01'")
    expect(client).toContain("X-LuckRead-Transport-Version': '1.0'")
    expect(client).toContain('X-LuckRead-Principal-User-Id')
    expect(client).toContain('Idempotency-Key')
    expect(client).toContain('If-Match')
    expect(route).toContain('callW07Subscription')
  })

  it('fails closed on subscription writes until verified billing synchronization is available', () => {
    const writeGuard = route.indexOf("if (request.method === 'POST')")
    const transportCall = route.indexOf('callW07Subscription({ request, pathname, method:')
    expect(writeGuard).toBeGreaterThan(-1)
    expect(transportCall).toBeGreaterThan(writeGuard)
    expect(route).toContain("'SERVICE_UNAVAILABLE'")
    expect(route).toContain('verified payment-provider synchronization flow')
    expect(route).not.toContain("requireHeader(request, 'Idempotency-Key')")
    expect(route).not.toContain("requireHeader(request, 'If-Match')")
  })

  it('declares the existing subscription collection list operation', () => {
    expect(openapi).toContain('operationId: listMembershipSubscriptions')
    expect(apiInventory.domains.subscription_entitlement_payment.endpoint_groups)
      .toContain('GET /v1/memberships/subscriptions')
    expect(route).toContain("parts.length === 0 && method === 'GET'")
  })

  it('exposes only the canonical subscription lifecycle paths', () => {
    expect(route).toContain("/memberships/subscriptions")
    expect(route).toContain("parts.length === 0 && method === 'GET'")
    expect(route).toContain("['cancel', 'pause', 'resume']")
    expect(route).toContain("'change-plan'")
    expect(route).not.toContain('entitlement')
  })
})
