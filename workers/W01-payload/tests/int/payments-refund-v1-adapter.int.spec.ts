import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const route = read('src/app/api/v1/payments/refunds/route.ts')
const commerceClient = read('src/commerce/w07-commerce-client.ts')
const w07Runtime = read('../W07-subscription-commerce/src/refund-http-runtime.ts')
const w07Persistence = read('../W07-subscription-commerce/src/refund-postgres-persistence.ts')
const w07PostgresRefundWebhook = read('../W07-subscription-commerce/src/refund-webhook-postgres-persistence.ts')
const w07WebhookRuntime = read('../W07-subscription-commerce/src/payment-webhook-http-runtime.ts')
const w07Provider = read('../W07-subscription-commerce/src/hyperswitch-client.ts')
const migration = read('../W07-subscription-commerce/migrations-d1-04/0006_refunds_billing_documents.sql')
const openapi = read('../../contracts/openapi/v1/openapi.yaml')
const apiInventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json'))
const operationPolicy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json'))
const binding = JSON.parse(read('../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'))
const routing = JSON.parse(read('../../contracts/transport/public-worker-terminal-routing.v1.json'))

describe('public customer payment refund adapter', () => {
  it('authenticates, checks own-Payment refund permission, validates idempotency and bounded body before W07 dispatch', () => {
    const session = route.indexOf('resolveCookieSubscriptionPrincipal(request)')
    const authz = route.indexOf('authorizePaymentRefundPermission(request, principal)')
    const idempotency = route.indexOf("validateOrderIdempotencyKey(request.headers.get('Idempotency-Key'))")
    const body = route.indexOf('readBoundedOrderBody(request)')
    const w07Call = route.indexOf('callW07Subscription({')
    expect(session).toBeGreaterThan(-1)
    expect(session).toBeLessThan(authz)
    expect(authz).toBeLessThan(idempotency)
    expect(idempotency).toBeLessThan(body)
    expect(body).toBeLessThan(w07Call)
    expect(route).toContain("pathname: '/commerce/payments/refunds'")
    expect(route).toContain("method: 'POST'")
    expect(route).toContain("idempotencyKey.length > 128")
    expect(route).not.toContain('HYPERSWITCH_API_KEY')
    const requestValidation = route.slice(
      route.indexOf('Object.keys(parsed.value).some'),
      route.indexOf('const response = await callW07Subscription({'),
    )
    expect(requestValidation).not.toContain('capturedAmountMinor')
  })

  it('uses the W08 payment.refund CASL permission on Payment and never substitutes order permission', () => {
    expect(commerceClient).toContain("action: 'payment.refund'")
    expect(commerceClient).toContain("resourceType: 'Payment'")
    expect(commerceClient).toContain("resourceAttributes: { ownerId: principal.userId }")
    expect(commerceClient).toContain("callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')")
    expect(route).not.toContain("authorizeOrderPermission(request, principal, 'order.read')")
  })

  it('makes W07 re-check payment ownership and captured amount before reserving a refund', () => {
    const selectedPool = w07Runtime.indexOf('(dependencies.getPostgresPool ?? getW07PaymentWebhookPostgresPool)(env)')
    const ownership = w07Runtime.indexOf('resolvePayment(\n      pool,')
    const providerRead = w07Runtime.indexOf('retrievePayment(config, input.paymentId)')
    const reservationRead = w07Runtime.indexOf('findExisting(pool,')
    const reserve = w07Runtime.indexOf('reserve(pool,')
    const providerCreate = w07Runtime.indexOf('create(config, {')
    expect(selectedPool).toBeGreaterThan(-1)
    expect(ownership).toBeGreaterThan(-1)
    expect(ownership).toBeLessThan(providerRead)
    expect(reservationRead).toBeLessThan(providerRead)
    expect(providerRead).toBeLessThan(reserve)
    expect(reserve).toBeLessThan(providerCreate)
    expect(w07Runtime).toContain('providerPayment.amountCaptured')
    expect(w07Runtime).toContain('providerPayment.merchantId')
    expect(w07Persistence).toContain('FROM payments WHERE payment_id = $1 AND customer_id = $2')
    expect(w07Persistence).toContain('FROM refunds WHERE customer_id = $1 AND idempotency_key = $2')
    expect(w07Persistence).toContain('INSERT INTO refunds')
    expect(w07Persistence).toContain('version = version + 1')
    expect(w07Persistence).toContain("errorCode(error) === '23505' || errorCode(error) === '23514'")
    expect(migration).toContain('UNIQUE (customer_id, idempotency_key)')
  })

  it('reuses the 30-character Hyperswitch refund ID and provider create/retrieve endpoints', () => {
    expect(w07Provider).toContain("'/refunds'")
    expect(w07Provider).toContain("'/refunds/' + encodeURIComponent(input.refundId)")
    expect(w07Provider).toContain('/^ref_[A-Za-z0-9]{26}$/')
    expect(w07Provider).toContain("refund_type: 'instant'")
    expect(w07Provider).toContain("amount_received: amountCaptured")
    expect(migration).toContain("length(refund_id) = 30")
    expect(migration).toContain("substr(refund_id, 1, 4) = 'ref_'")
  })

  it('requires signed provider refund events to finalize status and keeps subscription entitlement out of the refund path', () => {
    expect(w07PostgresRefundWebhook).toContain("envelope.eventType === 'refund_succeeded'")
    expect(w07PostgresRefundWebhook).toContain("envelope.eventType === 'refund_failed'")
    expect(w07PostgresRefundWebhook).toContain("envelope.eventType === 'refund_review'")
    expect(w07PostgresRefundWebhook).toContain('payloadSha256')
    expect(w07PostgresRefundWebhook).toContain("state = 'RECEIVED'")
    expect(w07Persistence).toContain('signed webhooks finalize outcomes')
    expect(w07Runtime).not.toContain('grantEntitlement(')
  })

  it('binds the public route, W07 service path, permission and operation policy to the same contract', () => {
    const start = openapi.indexOf('  /payments/refunds:')
    const end = openapi.indexOf('\n  /', start + 1)
    const block = openapi.slice(start, end)
    expect(block).toContain('operationId: postPaymentsRefunds')
    expect(block).toContain('paymentId')
    expect(block).toContain('amountMinor')
    expect(block).toContain('refundId')
    expect(block).toContain('capturedAmountMinor')
    expect(block).toContain('x-luckread-contract-status: CONTRACTED_PARTIAL')
    expect(apiInventory.domains.subscription_entitlement_payment.endpoint_groups)
      .toContain('POST /v1/payments/refunds')
    expect(operationPolicy.operations.find((item: { operationId: string }) => item.operationId === 'postPaymentsRefunds'))
      .toMatchObject({ permissions: ['payment.refund'], idempotencyRequired: true, auditRequired: true })
    expect(binding.operations.find((item: { operationId: string }) => item.operationId === 'postPaymentsRefunds'))
      .toMatchObject({
        publicPath: '/api/v1/payments/refunds',
        internalPath: '/commerce/payments/refunds',
        permission: 'payment.refund',
        minimumGlobalLayer: 'L2',
      })
    expect(routing.routes.find((item: { operationIdFamily: string }) => item.operationIdFamily === 'membership')
      .publicPaths).toContain('/api/v1/payments/refunds')
  })
  it('routes Neon refund_details webhooks through the native PostgreSQL transaction path', () => {
    expect(w07WebhookRuntime).toContain('receiveHyperswitchRefundWebhookPostgres')
    expect(w07WebhookRuntime).toContain('getW07PaymentWebhookPostgresPool')
    expect(w07PostgresRefundWebhook).toContain('verifyHyperswitchWebhookSignature')
    expect(w07PostgresRefundWebhook).toContain('BEGIN')
    expect(w07PostgresRefundWebhook).toContain('UPDATE refunds SET status')
    expect(w07PostgresRefundWebhook).toContain('UPDATE payment_provider_events SET state')
    expect(w07PostgresRefundWebhook).toContain('REFUND_VERSION_CAS_MISMATCH')
    expect(w07PostgresRefundWebhook).toContain('ROLLBACK')
  })

})
