import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('current-principal commerce order history adapter', () => {
  it('authenticates and authorizes the current principal before routing order history through W07', () => {
    const route = read('src/app/api/v1/commerce/orders/route.ts')
    const session = route.indexOf('resolveCookieSubscriptionPrincipal(request)')
    const permission = route.indexOf("authorizeOrderPermission(request, principal, 'order.read')")
    const binding = route.indexOf('callW07Subscription({')
    expect(route).toContain('export async function GET')
    expect(session).toBeGreaterThan(-1)
    expect(session).toBeLessThan(permission)
    expect(permission).toBeLessThan(binding)
    expect(route).toContain("pathname: '/commerce/orders' + suffix")
    expect(route).toContain("method: 'GET'")
    expect(route).not.toMatch(/fetch\s*\(\s*['"`]https?:\/\//)
  })

  it('keeps the owner predicate in W07 D1-04 and returns only the safe summary DTO', () => {
    const runtime = read('../W07-subscription-commerce/src/order-http-runtime.ts')
    const persistence = read('../W07-subscription-commerce/src/order-persistence.ts')
    const migration = read('../W07-subscription-commerce/migrations-d1-04/0001_order_commerce.sql')
    expect(runtime).toContain("request.method === 'GET' && segments.length === 2")
    expect(runtime).toContain('listCommerceOrders')
    expect(persistence).toContain("'FROM orders WHERE customer_id = ? '")
    expect(persistence).toContain("'AND (created_at < ? OR (created_at = ? AND order_id < ?)) ORDER BY created_at DESC, order_id DESC LIMIT ?'")
    expect(persistence).toContain('scopeHash !== expectedScopeHash')
    expect(persistence).toContain('const scopeHash = await commerceOrderListScopeHash(customerId)')
    expect(persistence).not.toContain('customerId: row.customer_id')
    expect(persistence).not.toContain('itemSnapshotJson: line.item_snapshot_json')
    expect(migration).toContain('CREATE INDEX ix_orders_customer_created_order ON orders(customer_id, created_at, order_id)')
  })

  it('registers the list operation with the existing order.read permission and unchanged topology', () => {
    const inventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json'))
    const policy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json'))
    const binding = JSON.parse(read('../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'))
    const openapi = read('../../contracts/openapi/v1/openapi.yaml')
    const orderHistoryOperation = openapi.split('operationId: listCommerceOrders')[1]?.split('    post:')[0] ?? ''
    expect(inventory.domains.subscription_entitlement_payment.endpoint_groups).toContain('GET /v1/commerce/orders')
    expect(policy.operations.find((item: { operationId: string }) => item.operationId === 'listCommerceOrders')).toMatchObject({
      permissions: ['order.read'],
      auditRequired: false,
      optimisticLockRequired: false,
      idempotencyRequired: false,
    })
    expect(binding.operations.find((item: { operationId: string }) => item.operationId === 'listCommerceOrders')).toMatchObject({
      method: 'GET',
      publicPath: '/api/v1/commerce/orders',
      internalPath: '/commerce/orders',
      principalRequired: true,
      permission: 'order.read',
    })
    expect(binding.operations.find((item: { operationId: string }) => item.operationId === 'listCommerceOrders').topologyConstraints).toMatchObject({
      newWorker: false,
      newDatabase: false,
      newQueue: false,
      newServiceBinding: false,
      d1Authority: 'D1-04',
      crossD1Transactions: 0,
    })
    expect(openapi).toContain('operationId: listCommerceOrders')
    expect(openapi).toContain('x-luckread-runtime-status: IMPLEMENTATION_CANDIDATE_PENDING_VERIFICATION')
    expect(openapi).toContain('not a tax invoice')
    expect(orderHistoryOperation).toContain('maximum: 50')
    expect(orderHistoryOperation).toContain('maxLength: 2048')
    expect(orderHistoryOperation).toContain("nextCursor: { type: [string, 'null'], maxLength: 2048 }")
    expect(orderHistoryOperation).toContain("pattern: '^ord_[A-Za-z0-9_-]{1,90}
  })

  it('exposes purchase history in Android and H5 without introducing client-side payment authority', () => {
    const androidApi = read('../../app/lib/subscriptions-api.ts')
    const androidScreen = read('../../app/app/(drawer)/billing-history.tsx')
    const subscriptions = read('../../app/app/(drawer)/subscriptions.tsx')
    const h5Page = read('src/app/(frontend)/me/billing-history/BillingHistoryPage.tsx')
    const h5Subscriptions = read('src/app/(frontend)/me/subscriptions/MySubscriptionsPage.tsx')
    const h5Route = read('src/app/(twitter-clone)/me/billing-history/page.tsx')
    expect(androidApi).toContain("apiRequest<unknown>('/commerce/orders?' + query.toString()")
    expect(androidScreen).toContain('fetchMyCommerceOrdersPage')
    expect(subscriptions).toContain("router.push('/billing-history' as never)")
    expect(h5Page).toContain("'/api/v1/commerce/orders?' + query.toString()")
    expect(h5Page).toContain("window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(h5Subscriptions).toContain('href="/me/billing-history"')
    expect(h5Route).toContain('<BillingHistoryPage />')
    expect(androidScreen).not.toMatch(/paymentToken|clientSecret|merchantId/)
    expect(h5Page).not.toMatch(/paymentToken|clientSecret|merchantId/)
  })
})
")
  })

  it('exposes purchase history in Android and H5 without introducing client-side payment authority', () => {
    const androidApi = read('../../app/lib/subscriptions-api.ts')
    const androidScreen = read('../../app/app/(drawer)/billing-history.tsx')
    const subscriptions = read('../../app/app/(drawer)/subscriptions.tsx')
    const h5Page = read('src/app/(frontend)/me/billing-history/BillingHistoryPage.tsx')
    const h5Subscriptions = read('src/app/(frontend)/me/subscriptions/MySubscriptionsPage.tsx')
    const h5Route = read('src/app/(twitter-clone)/me/billing-history/page.tsx')
    expect(androidApi).toContain("apiRequest<unknown>('/commerce/orders?' + query.toString()")
    expect(androidScreen).toContain('fetchMyCommerceOrdersPage')
    expect(subscriptions).toContain("router.push('/billing-history' as never)")
    expect(h5Page).toContain("'/api/v1/commerce/orders?' + query.toString()")
    expect(h5Page).toContain("window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(h5Subscriptions).toContain('href="/me/billing-history"')
    expect(h5Route).toContain('<BillingHistoryPage />')
    expect(androidScreen).not.toMatch(/paymentToken|clientSecret|merchantId/)
    expect(h5Page).not.toMatch(/paymentToken|clientSecret|merchantId/)
  })
})
