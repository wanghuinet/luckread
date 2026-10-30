import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('public owner-scoped payment detail and status adapter', () => {
  it('authenticates and checks order.read before forwarding a payment ID to W07', () => {
    const route = read('src/app/api/v1/payments/[paymentId]/route.ts')
    const session = route.indexOf('resolveCookieSubscriptionPrincipal(request)')
    const permission = route.indexOf("authorizeOrderPermission(request, principal, 'order.read')")
    const forward = route.indexOf('callW07Subscription({')
    expect(route).toContain('export async function GET')
    expect(session).toBeGreaterThan(-1)
    expect(session).toBeLessThan(permission)
    expect(permission).toBeLessThan(forward)
    expect(route).toContain("pathname: '/payments/' + encodeURIComponent(paymentId)")
    expect(route).toContain("method: 'GET'")
    expect(route).toContain('validatePaymentStatusEnvelope')
    expect(route).not.toMatch(/fetch\s*\(\s*['"`]https?:\/\//)
  })

  it('keeps payment ownership and the persisted status authority inside W07/D1-04', () => {
    const runtime = read('../W07-subscription-commerce/src/payment-status-http-runtime.ts')
    const persistence = read('../W07-subscription-commerce/src/payment-persistence.ts')
    const client = read('../W07-subscription-commerce/src/hyperswitch-client.ts')
    const index = read('../W07-subscription-commerce/src/index.ts')

    expect(persistence).toContain('FROM payments WHERE payment_id = ? AND customer_id = ? LIMIT 1')
    expect(persistence).toContain("throw new PaymentPersistenceError('RESOURCE_NOT_FOUND', 404)")
    expect(runtime).toContain("statusAuthority: 'W07_D1_04'")
    expect(runtime).toContain('observed.status === payment.status ?')
    expect(runtime).toContain('retrieveProvider(config, payment.paymentId, undefined, true)')
    expect(runtime).not.toContain('UPDATE payments')
    expect(runtime).not.toContain('confirmOrder')
    expect(runtime).not.toContain('grantEntitlement')
    expect(client).toContain("'?force_sync=true'")
    expect(index).toContain('handlePaymentStatusRequest(request, principal, env)')
  })

  it('registers exact authorization, transport and OpenAPI contracts without topology growth', () => {
    const inventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json'))
    const policy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json'))
    const binding = JSON.parse(read('../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'))
    const routing = JSON.parse(read('../../contracts/transport/public-worker-terminal-routing.v1.json'))
    const openapi = read('../../contracts/openapi/v1/openapi.yaml')
    const operation = openapi.split('operationId: getPaymentsPaymentId')[1]?.split('  /payments/intents:')[0] ?? ''

    expect(inventory.domains.subscription_entitlement_payment.endpoint_groups)
      .toContain('GET /v1/payments/{paymentId}')
    expect(policy.operations.find((item: { operationId: string }) => item.operationId === 'getPaymentsPaymentId')).toMatchObject({
      permissions: ['order.read'],
      auditRequired: false,
      optimisticLockRequired: false,
      idempotencyRequired: false,
    })
    const transport = binding.operations.find((item: { operationId: string }) => item.operationId === 'getPaymentsPaymentId')
    expect(transport).toMatchObject({
      method: 'GET',
      publicPath: '/api/v1/payments/{paymentId}',
      internalPath: '/payments/{paymentId}',
      principalRequired: true,
      permission: 'order.read',
      minimumGlobalLayer: 'L2',
      cache: 'NO_STORE',
    })
    expect(transport.topologyConstraints).toMatchObject({
      newWorker: false,
      newDatabase: false,
      newQueue: false,
      newServiceBinding: false,
      d1Authority: 'D1-04',
      crossD1Transactions: 0,
    })
    const membershipRoute = routing.routes.find((item: { operationIdFamily: string }) => item.operationIdFamily === 'membership')
    expect(membershipRoute.publicPaths).toContain('/api/v1/payments/{paymentId}')
    expect(operation).toContain('x-luckread-runtime-status: IMPLEMENTATION_CANDIDATE_PENDING_VERIFICATION')
    expect(operation).toContain('statusAuthority: { type: string, const: W07_D1_04 }')
    expect(operation).toContain('providerStatusCheck: { type: string, enum: [MATCH, DIFFERS, UNAVAILABLE] }')
    expect(operation).toContain('client secrets')
  })

  it('carries the persisted payment ID through the hosted checkout return path into server status lookup', () => {
    const checkout = read('src/app/(frontend)/checkout/CheckoutClient.tsx')
    const resultPage = read('src/app/(frontend)/checkout/result/page.tsx')
    expect(checkout).toContain("returnUrl.searchParams.set('paymentId', intent.paymentId)")
    expect(checkout).toContain("return_url: returnUrl.toString()")
    expect(checkout).toContain("href={'/checkout/result?paymentId=' + encodeURIComponent(intent.paymentId)}")
    expect(resultPage).toContain("'/api/v1/payments/' + encodeURIComponent(paymentId)")
    expect(resultPage).toContain("payment.providerStatusCheck === 'DIFFERS'")
    expect(resultPage).toContain("payment.payment.status === 'succeeded'")
    expect(resultPage).toContain('本页面不会直接授予权限')
    expect(resultPage).not.toContain('payment_succeeded')
  })

  it('does not return provider credentials, mandate references, or browser-controlled payment truth', () => {
    const route = read('src/app/api/v1/payments/[paymentId]/route.ts')
    const runtime = read('../W07-subscription-commerce/src/payment-status-http-runtime.ts')
    const persistence = read('../W07-subscription-commerce/src/payment-persistence.ts')
    const dto = runtime.slice(runtime.indexOf('type PaymentStatusResponse'), runtime.indexOf('export type PaymentStatusDependencies'))
    expect(persistence).toContain("!/^ord_[A-Za-z0-9_-]{1,90}$/.test(row.order_id)")
    expect(route).not.toMatch(/clientSecret|merchantId|paymentMethodId|mandateId/)
    expect(dto).not.toMatch(/clientSecret|merchantId|paymentMethodId|mandateId|idempotencyKey|failureCode/)
    expect(runtime).toContain('A live provider read is an observation only')
    expect(runtime).toContain('cannot confirm an Order or')
  })
})
