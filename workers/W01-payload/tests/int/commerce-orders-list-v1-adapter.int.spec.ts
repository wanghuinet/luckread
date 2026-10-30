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

  it('queries orders and their newest payment ID only within the authenticated customer scope', () => {
    const runtime = read('../W07-subscription-commerce/src/order-http-runtime.ts')
    const persistence = read('../W07-subscription-commerce/src/order-persistence.ts')
    const migration = read('../W07-subscription-commerce/migrations-d1-04/0001_order_commerce.sql')
    const paymentMigration = read('../W07-subscription-commerce/migrations-d1-04/0002_payment_provider_events.sql')
    expect(runtime).toContain("request.method === 'GET' && segments.length === 2")
    expect(runtime).toContain('listCommerceOrders')
    expect(persistence).toContain("'FROM orders WHERE customer_id = ? '")
    expect(persistence).toContain("p.order_id = orders.order_id AND p.customer_id = orders.customer_id")
    expect(persistence).toContain('ORDER BY p.created_at DESC, p.payment_id DESC LIMIT 1')
    expect(persistence).toContain("!/^pay_[A-Za-z0-9]{26}$/.test(row.latest_payment_id)")
    expect(persistence).toContain('scopeHash !== expectedScopeHash')
    expect(persistence).not.toContain('customerId: row.customer_id')
    expect(persistence).not.toContain('merchantId: row.merchant_id')
    expect(migration).toContain('CREATE INDEX ix_orders_customer_created_order ON orders(customer_id, created_at, order_id)')
    expect(paymentMigration).toContain('CREATE INDEX ix_payments_order_created_payment ON payments(order_id, created_at, payment_id)')
  })

  it('registers the order list with owner-read authorization and unchanged topology', () => {
    const inventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json'))
    const policy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json'))
    const binding = JSON.parse(read('../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'))
    const openapi = read('../../contracts/openapi/v1/openapi.yaml')
    const operation = openapi.split('operationId: listCommerceOrders')[1]?.split('    post:')[0] ?? ''
    expect(inventory.domains.subscription_entitlement_payment.endpoint_groups).toContain('GET /v1/commerce/orders')
    expect(policy.operations.find((item: { operationId: string }) => item.operationId === 'listCommerceOrders')).toMatchObject({
      permissions: ['order.read'],
      auditRequired: false,
      optimisticLockRequired: false,
      idempotencyRequired: false,
    })
    const transport = binding.operations.find((item: { operationId: string }) => item.operationId === 'listCommerceOrders')
    expect(transport).toMatchObject({
      method: 'GET',
      publicPath: '/api/v1/commerce/orders',
      internalPath: '/commerce/orders',
      principalRequired: true,
      permission: 'order.read',
    })
    expect(transport.topologyConstraints).toMatchObject({
      newWorker: false,
      newDatabase: false,
      newQueue: false,
      newServiceBinding: false,
      d1Authority: 'D1-04',
      crossD1Transactions: 0,
    })
    expect(operation).toContain('maximum: 50')
    expect(operation).toContain('maxLength: 2048')
    expect(operation).toContain("nextCursor: { type: [string, 'null'], maxLength: 2048 }")
    expect(operation).toContain("latestPaymentId: { type: [string, 'null'], pattern: '^pay_[A-Za-z0-9]{26}$' }")
    expect(operation).toContain('latestPaymentId is the newest')
    expect(operation).toContain('not a tax invoice')
  })

  it('exposes purchase history and payment detail in Android and H5 without client-side payment authority', () => {
    const androidApi = read('../../app/lib/subscriptions-api.ts')
    const androidScreen = read('../../app/app/(drawer)/billing-history.tsx')
    const androidPaymentScreen = read('../../app/app/(drawer)/payment-status.tsx')
    const subscriptions = read('../../app/app/(drawer)/subscriptions.tsx')
    const h5Page = read('src/app/(frontend)/me/billing-history/BillingHistoryPage.tsx')
    const h5PaymentPage = read('src/app/(frontend)/checkout/result/page.tsx')
    const h5Subscriptions = read('src/app/(frontend)/me/subscriptions/MySubscriptionsPage.tsx')
    const h5Route = read('src/app/(twitter-clone)/me/billing-history/page.tsx')
    expect(androidApi).toContain("apiRequest<unknown>('/commerce/orders?' + query.toString()")
    expect(androidApi).toContain("'/payments/' + encodeURIComponent(paymentId)")
    expect(androidScreen).toContain('fetchMyCommerceOrdersPage')
    expect(androidScreen).toContain("router.push(('/payment-status?paymentId=' + encodeURIComponent(paymentId)) as never)")
    expect(androidPaymentScreen).toContain('fetchMyPaymentStatus')
    expect(androidPaymentScreen).toContain("payment.providerStatusCheck === 'DIFFERS'")
    expect(subscriptions).toContain("router.push('/billing-history' as never)")
    expect(h5Page).toContain("'/api/v1/commerce/orders?' + query.toString()")
    expect(h5Page).toContain("'/checkout/result?paymentId=' + encodeURIComponent(item.latestPaymentId)")
    expect(h5PaymentPage).toContain("'/api/v1/payments/' + encodeURIComponent(paymentId)")
    expect(h5Subscriptions).toContain('href="/me/billing-history"')
    expect(h5Route).toContain('<BillingHistoryPage />')
    expect(androidPaymentScreen).not.toMatch(/clientSecret|merchantId|paymentMethodId|mandateId/)
    expect(h5PaymentPage).not.toMatch(/clientSecret|merchantId|paymentMethodId|mandateId/)
  })
})
