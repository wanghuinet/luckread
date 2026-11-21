import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const route = read('src/app/api/v1/payments/intents/route.ts')
const checkout = read('src/app/(frontend)/checkout/CheckoutClient.tsx')
const resultPage = read('src/app/(frontend)/checkout/result/page.tsx')
const w07Client = read('../W07-subscription-commerce/src/hyperswitch-client.ts')
const w07PaymentRuntime = read('../W07-subscription-commerce/src/payment-intent-http-runtime.ts')
const w07OrderRuntime = read('../W07-subscription-commerce/src/order-http-runtime.ts')
const openapi = read('../../contracts/openapi/v1/openapi.yaml')
const binding = JSON.parse(read('../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'))
const routing = JSON.parse(read('../../contracts/transport/public-worker-terminal-routing.v1.json'))
const apiInventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json'))
const operationPolicy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json'))

describe('public Hyperswitch payment intent adapter', () => {
  it('authenticates and checks current order access before dispatching through the existing W07 service binding', () => {
    const session = route.indexOf('resolveCookieSubscriptionPrincipal(request)')
    const authz = route.indexOf("authorizeOrderPermission(request, principal, 'order.read')")
    const idempotency = route.indexOf("validateOrderIdempotencyKey(request.headers.get('Idempotency-Key'))")
    const body = route.indexOf('readBoundedOrderBody(request)')
    const w07Call = route.indexOf('callW07Subscription({')
    expect(session).toBeGreaterThan(-1)
    expect(session).toBeLessThan(authz)
    expect(authz).toBeLessThan(idempotency)
    expect(idempotency).toBeLessThan(body)
    expect(body).toBeLessThan(w07Call)
    expect(route).toContain("pathname: '/commerce/orders/' + encodeURIComponent(orderId) + '/payment-intent'")
    expect(route).toContain("method: 'POST'")
    expect(route).not.toMatch(/fetch\s*\(\s*['"`]https?:\/\//)
    expect(route).not.toContain('HYPERSWITCH_API_KEY')
    expect(route).not.toContain('card_number')
  })

  it('accepts only the existing order ID and validates the exact owner-bound W07 response before returning clientSecret', () => {
    expect(route).toContain("Object.keys(parsed.value).length !== 1")
    expect(route).toContain("typeof parsed.value.orderId !== 'string'")
    expect(route).toContain('data.orderId !== expectedOrderId')
    expect(route).toContain('data.amountMinor')
    expect(route).toContain('data.currency')
    expect(route).toContain('data.clientSecret.length > 4096')
    expect(route).toContain('data.sdkAuthorization.length > 4096')
    expect(route).toContain('Object.keys(data).length !== 9')
    expect(route).toContain("headers.set('cache-control', 'no-store')")
    expect(route).toContain("headers.set('pragma', 'no-cache')")
  })

  it('uses Hyperswitch-hosted secure payment fields and its explicit saved-method checkbox instead of collecting card data locally', () => {
    expect(checkout).toContain('https://beta.hyperswitch.io/v1/HyperLoader.js')
    expect(checkout).toContain('https://checkout.hyperswitch.io/v0/HyperLoader.js')
    expect(checkout).toContain('NEXT_PUBLIC_HYPERSWITCH_ENVIRONMENT')
    expect(checkout).toContain("import { apiFetch } from '../../../lib/client-api.js'")
    expect(checkout).toContain("apiFetch('/api/v1/payments/intents'")
    expect(checkout).not.toMatch(/\bfetch\s*\(/)
    expect(checkout).toContain("widgetSet.create('payment', { layout: 'tabs', displaySavedPaymentMethodsCheckbox: true, savedPaymentMethodsCheckboxCheckedByDefault: false })")
    expect(checkout).toContain("savedPaymentMethodsCheckboxCheckedByDefault: false")
    expect(checkout).toContain("hyper.confirmPayment({")
    expect(checkout).toContain("redirect: 'if_required'")
    expect(checkout).toContain("'Idempotency-Key': idempotencyKey")
    expect(checkout).toContain("cache: 'no-store'")
    expect(checkout).toContain('window.sessionStorage')
    expect(checkout).toContain('Object.keys(intent).length !== 9')
    expect(checkout).toContain('intent.sdkAuthorization')
    expect(checkout).toContain('请只在 Hyperswitch 托管支付表单明确显示的“保存支付方式”选项中主动勾选授权')
    expect(checkout).not.toMatch(/<input[^>]+(card|cvc|cvv|pan|expiry)/i)
    expect(checkout).not.toContain('card_number')
  })

  it('binds setup_future_usage to the authenticated customer but does not mistake it for durable consent or entitlement', () => {
    expect(w07Client).toContain("customer_id: input.customerId")
    expect(w07Client).toContain("setup_future_usage: 'off_session'")
    expect(w07PaymentRuntime).toContain('createHyperswitchCustomerInitiatedSetupIntent')
    expect(w07PaymentRuntime).toContain('customerId,')
    expect(w07PaymentRuntime).toContain('This does not capture funds, confirm an Order')
    expect(w07PaymentRuntime).toContain('grant an\n * entitlement')
    expect(w07PaymentRuntime).not.toContain('grantEntitlement(')
  })

  it('keeps return pages and payment result UI non-authoritative until the later webhook/reconciliation module', () => {
    expect(checkout).toContain('最终状态仍需服务器核验')
    expect(checkout).toContain('不会直接开通会员权益')
    expect(resultPage).toContain('服务器尚需核验支付结果')
    expect(resultPage).toContain('不会在此页面直接开通会员权益')
    expect(resultPage).not.toContain('payment_succeeded')
  })

  it('keeps public OpenAPI and private W07 transport/routing contracts aligned without topology growth', () => {
    const paymentStart = openapi.indexOf('  /payments/intents:')
    const paymentEnd = openapi.indexOf('\n  /', paymentStart + 1)
    const paymentBlock = openapi.slice(paymentStart, paymentEnd)
    expect(paymentBlock).toContain('operationId: postPaymentsIntents')
    expect(paymentBlock).toContain('x-luckread-contract-status: CONTRACTED_PARTIAL')
    expect(paymentBlock).toContain("required: [orderId]")
    expect(paymentBlock).toContain('clientSecret')
    expect(paymentBlock).toContain('sdkAuthorization')
    expect(paymentBlock).toContain('pricingMode')
    expect(paymentBlock.toLowerCase()).toContain('cache-control')
    const operation = binding.operations.find((item: { operationId: string }) => item.operationId === 'postPaymentsIntents')
    expect(operation).toBeDefined()
    expect(operation.publicPath).toBe('/api/v1/payments/intents')
    expect(operation.responseFields).toContain('pricingMode')
    expect(operation.responseFields).toContain('sdkAuthorization')
    expect(operation.internalPath).toBe('/commerce/orders/{orderId}/payment-intent')
    expect(operation.topologyConstraints).toMatchObject({
      newWorker: false,
      newDatabase: false,
      newQueue: false,
      newServiceBinding: false,
      crossD1Transactions: 0,
    })
    expect(routing.routes.find((item: { operationIdFamily: string }) => item.operationIdFamily === 'membership')
      .publicPaths).toContain('/api/v1/payments/intents')
    expect(apiInventory.domains.subscription_entitlement_payment.endpoint_groups)
      .toContain('POST /v1/payments/intents')
    const policy = operationPolicy.operations.find((item: { operationId: string }) => item.operationId === 'postPaymentsIntents')
    expect(policy).toMatchObject({
      permissions: ['order.read'],
      auditRequired: true,
      idempotencyRequired: true,
      'x-luckread-contract-status': 'CONTRACTED_PARTIAL',
    })
  })

  it('does not bypass the existing closed order-pricing admission gate', () => {
    expect(w07OrderRuntime).toContain('if (!dependencies.resolvePricing)')
    expect(w07OrderRuntime).toContain('Order creation is disabled until the authoritative pricing and tax decision is admitted')
  })
})
