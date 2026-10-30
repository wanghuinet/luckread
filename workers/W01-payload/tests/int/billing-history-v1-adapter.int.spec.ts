import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const refundRoute = read('src/app/api/v1/payments/refunds/route.ts')
const paymentsRoute = read('src/app/api/v1/payments/history/route.ts')
const billingRoute = read('src/app/api/v1/billing/documents/route.ts')
const commerceClient = read('src/commerce/w07-commerce-client.ts')
const w07ReadRuntime = read('../W07-subscription-commerce/src/billing-read-http-runtime.ts')
const billingPersistence = read('../W07-subscription-commerce/src/billing-persistence.ts')
const billingMigration = read('../W07-subscription-commerce/migrations-d1-04/0006_refunds_billing_documents.sql')
const orderRuntime = read('../W07-subscription-commerce/src/order-http-runtime.ts')
const webhookRuntime = read('../W07-subscription-commerce/src/payment-webhook-http-runtime.ts')
const apiInventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json'))
const operationPolicy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json'))
const sourcePolicy = JSON.parse(read('../../contracts/api/commerce-operation-policy.v1.json'))
const binding = JSON.parse(read('../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'))
const routing = JSON.parse(read('../../contracts/transport/public-worker-terminal-routing.v1.json'))
const authzPermissions = JSON.parse(read('../../contracts/authz/permissions.json'))
const casl = read('../W08-creator/src/authz/casl-policy.ts')
const openapiSync = read('../../scripts/sync-rc-openapi.mjs')

describe('public customer payment and billing history adapters', () => {
  it('requires W02 session and W08 own-Payment authorization before reading refund history', () => {
    const session = refundRoute.indexOf('resolveCookieSubscriptionPrincipal(request)')
    const authz = refundRoute.indexOf('authorizePaymentReadPermission(request, principal)', refundRoute.indexOf('export async function GET'))
    const call = refundRoute.indexOf("pathname: '/commerce/payments/refunds' + query")
    expect(session).toBeGreaterThan(-1)
    expect(authz).toBeGreaterThan(session)
    expect(call).toBeGreaterThan(authz)
    expect(refundRoute).toContain("pathname: '/commerce/payments/refunds'")
    expect(refundRoute).toContain("pathname: '/commerce/payments/refunds' + query")
    expect(refundRoute).not.toContain('D1_04')
    expect(refundRoute).not.toContain('HYPERSWITCH_API_KEY')
  })

  it('requires W02 session and W08 payment.read permission before reading payment history and billing documents', () => {
    for (const [route, path] of [
      [paymentsRoute, '/commerce/payments/history'],
      [billingRoute, '/commerce/billing/documents'],
    ]) {
      const session = route.indexOf('resolveCookieSubscriptionPrincipal(request)')
      const authz = route.indexOf('authorizePaymentReadPermission(request, principal)')
      const call = route.indexOf('callW07Subscription({')
      expect(session).toBeGreaterThan(-1)
      expect(authz).toBeGreaterThan(session)
      expect(call).toBeGreaterThan(authz)
      expect(route).toContain(path)
      expect(route).toContain("headers.set('cache-control', 'no-store')")
      expect(route).not.toContain('D1_04')
      expect(route).not.toContain('HYPERSWITCH_API_KEY')
    }
  })

  it('checks Payment owner in W08 and grants payment.read only through the own-payment CASL condition', () => {
    expect(commerceClient).toContain("action: 'payment.read'")
    expect(commerceClient).toContain("resourceType: 'Payment'")
    expect(commerceClient).toContain("resourceAttributes: { ownerId: principal.userId }")
    expect(casl).toContain("grant('payment.read', 'Payment', selfOwnerCondition(input.subjectId))")
    expect(authzPermissions['x-permissions']).toContainEqual(expect.objectContaining({
      name: 'payment.read', resource: 'payment', action: 'read', minLayer: 'L2', scope: 'own',
    }))
    for (const role of ['verified_user', 'admin', 'super_admin']) {
      const definition = authzPermissions['x-role-permissions'].roles.find((item: { role: string }) => item.role === role)
      expect(definition?.permissions).toContain('payment.read')
    }
  })

  it('re-queries every billing domain by server-derived customerId and uses bounded keyset pagination', () => {
    expect(w07ReadRuntime).toContain('listBillingDocumentsForCustomer')
    expect(w07ReadRuntime).toContain('listPaymentHistoryForCustomer')
    expect(w07ReadRuntime).toContain('listRefundHistoryForCustomer')
    expect(w07ReadRuntime).toContain('env.D1_04, customerId, limit, cursor')
    expect(billingPersistence).toContain('WHERE customer_id = ?')
    expect(billingPersistence).toContain('ORDER BY issued_at DESC, document_id DESC LIMIT ?')
    expect(billingPersistence).toContain('ORDER BY p.created_at DESC, p.payment_id DESC LIMIT ?')
    expect(billingPersistence).toContain('ORDER BY created_at DESC, refund_id DESC LIMIT ?')
    expect(billingPersistence).not.toContain('OFFSET ?')
  })

  it('creates invoice snapshots from D1-04 orders and receipts only after signed successful payment state', () => {
    expect(orderRuntime).toContain('issueInvoiceForOrder')
    expect(orderRuntime).toContain('await issueInvoice(env.D1_04, customerId, result.data.orderId)')
    expect(webhookRuntime).toContain('isSignedPaymentSucceededEvent(rawBody)')
    expect(webhookRuntime).toContain('issueReceiptForPaidPayment')
    expect(webhookRuntime).toContain('await issueReceipt(env.D1_04, paymentId, env.HYPERSWITCH_MERCHANT_ID)')
    expect(billingPersistence).toContain("readDocument(db, customerIdInput, 'INVOICE', orderIdInput)")
    expect(billingPersistence).toContain("readDocument(db, payment.customer_id, 'RECEIPT', payment.order_id)")
    expect(billingMigration).toContain("document_type IN ('INVOICE','RECEIPT')")
    expect(billingPersistence).toContain('issueInvoiceForOrder(db, payment.customer_id, payment.order_id, dependencies)')
    expect(billingPersistence).toContain('ON CONFLICT(document_type,order_id) DO NOTHING')
  })

  it('keeps the inventory, canonical commerce policy source, consolidated policy, W07 binding and terminal routing aligned', () => {
    const endpoints = apiInventory.domains.subscription_entitlement_payment.endpoint_groups
    for (const endpoint of [
      'POST /v1/payments/refunds',
      'GET /v1/payments/refunds',
      'GET /v1/payments/history',
      'GET /v1/billing/documents',
    ]) expect(endpoints).toContain(endpoint)

    for (const operationId of [
      'postPaymentsRefunds',
      'getPaymentsRefunds',
      'getPaymentsHistory',
      'getBillingDocuments',
    ]) {
      expect(sourcePolicy.operations.find((item: { operationId: string }) => item.operationId === operationId)).toBeTruthy()
      const operation = operationPolicy.operations.find((item: { operationId: string }) => item.operationId === operationId)
      expect(operation).toMatchObject({
        permissions: [operationId === 'postPaymentsRefunds' ? 'payment.refund' : 'payment.read'],
        'x-luckread-contract-status': 'CONTRACTED_PARTIAL',
        'x-luckread-source': 'contracts/api/commerce-operation-policy.v1.json',
      })
      expect(binding.operations.find((item: { operationId: string }) => item.operationId === operationId)).toBeTruthy()
    }

    const paths = routing.routes.find((item: { operationIdFamily: string }) => item.operationIdFamily === 'membership')?.publicPaths ?? []
    for (const path of [
      '/api/v1/payments/refunds',
      '/api/v1/payments/history',
      '/api/v1/billing/documents',
    ]) expect(paths).toContain(path)

    expect(openapiSync).toContain('buildCommerceOpenApiOperation')
    expect(openapiSync).toContain("operationId === 'postPaymentsRefunds'")
    expect(openapiSync).toContain("operationId === 'getPaymentsHistory'")
    expect(openapiSync).toContain("operationId === 'getPaymentsRefunds'")
    expect(openapiSync).toContain("operationId === 'getBillingDocuments'")
  })
})
