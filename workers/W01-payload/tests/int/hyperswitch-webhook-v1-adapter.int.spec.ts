import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/webhooks/hyperswitch/route.ts'), 'utf8')
const bodyReader = readFileSync(resolve(process.cwd(), 'src/subscription/provider-webhook-body.ts'), 'utf8')
const client = readFileSync(resolve(process.cwd(), 'src/subscription/w07-subscription-client.ts'), 'utf8')
const receiver = readFileSync(resolve(process.cwd(), '../../workers/W07-subscription-commerce/src/payment-webhook-http-runtime.ts'), 'utf8')
const persistence = readFileSync(resolve(process.cwd(), '../../workers/W07-subscription-commerce/src/payment-persistence.ts'), 'utf8')
const openapi = readFileSync(resolve(process.cwd(), '../../contracts/openapi/v1/openapi.yaml'), 'utf8')
const inventory = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/api/api-inventory.v1.json'), 'utf8'))
const transport = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'), 'utf8'))
const policy = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/openapi/v1/operation-policy.json'), 'utf8'))

describe('Hyperswitch provider webhook ingress', () => {
  it('bounds the public raw body before forwarding it to W07', () => {
    expect(route).toContain('readBoundedProviderWebhookBody(request, errorResponse)')
    expect(bodyReader).toContain('MAX_PROVIDER_WEBHOOK_BODY_BYTES = 1024 * 1024')
    expect(bodyReader).toContain('request.body.getReader()')
    expect(bodyReader).toContain('length > MAX_PROVIDER_WEBHOOK_BODY_BYTES')
    expect(route).toContain('forwardW07HyperswitchWebhook({ request, rawBody })')
    expect(route).not.toContain('request.json()')
    expect(route).not.toContain('JSON.stringify')
    expect(route).not.toContain('resolveCookieSubscriptionPrincipal')
  })

  it('requires W06 durable audit before acknowledging a paid subscription plan change webhook', () => {
    expect(route).toContain('callW06SubscriptionPlanChangeAudit')
    expect(route).toContain('membershipPurchaseFulfillment')
    expect(route).toContain('subscriptionPlanChangeAudit')
    expect(route).toContain('delete fulfillmentObject.subscriptionPlanChangeAudit')
    expect(route).toContain('AUDIT_UNAVAILABLE')
    expect(route).toContain('evt_spc_')
  })

  it('forwards only the exact body, signature and fixed transport metadata', () => {
    expect(client).toContain('/internal/webhooks/hyperswitch')
    expect(client).toContain("input.request.headers.get('X-Webhook-Signature-512')")
    expect(client).toContain('body: input.rawBody')
    expect(client).toContain("'X-LuckRead-Caller': 'W01'")
    expect(client).not.toContain("headers.set('cookie'")
    expect(client).not.toContain("headers.set('authorization'")
    expect(client).not.toContain('request.json()')
  })

  it('requires the W01 binding envelope and verifies the provider signature in W07', () => {
    expect(receiver).toContain("request.headers.get('X-LuckRead-Caller') !== 'W01'")
    expect(receiver).toContain("request.headers.get('X-LuckRead-Transport-Version') !== '1.0'")
    expect(receiver).toContain("const SIGNATURE_HEADER = 'X-Webhook-Signature-512'")
    expect(receiver).toContain('signatureHeader: request.headers.get(SIGNATURE_HEADER)')
    expect(receiver).toContain('receiveHyperswitchWebhook')
    expect(receiver).toContain('HYPERSWITCH_WEBHOOK_SECRET')
    expect(receiver).toContain('HYPERSWITCH_MERCHANT_ID')
    expect(persistence).toContain('verifyHyperswitchWebhookSignature')
    expect(persistence).toContain('recordWebhookConflict')
    expect(receiver).not.toContain('grantSubscriptionEntitlement')
    expect(receiver).not.toContain('postLedger')
  })

  it('contracts the public W01 path, private W07 path, byte limit and signature header', () => {
    expect(inventory.domains.subscription_entitlement_payment.endpoint_groups).toContain('POST /v1/webhooks/hyperswitch')
    expect(openapi).toContain('operationId: receiveHyperswitchPaymentWebhook')
    expect(openapi).toContain('name: X-Webhook-Signature-512')
    expect(openapi).toContain('x-luckread-max-body-bytes: 1048576')
    const operation = transport.operations.find((item: { operationId: string }) => item.operationId === 'receiveHyperswitchPaymentWebhook')
    expect(operation).toMatchObject({
      publicPath: '/api/v1/webhooks/hyperswitch',
      internalPath: '/internal/webhooks/hyperswitch',
      principalRequired: false,
      rawBodyPreserved: true,
      maximumBodyBytes: 1048576,
    })
    const policyOperation = policy.operations.find((item: { operationId: string }) => item.operationId === 'receiveHyperswitchPaymentWebhook')
    expect(policyOperation).toMatchObject({ auth: { mode: 'public' }, idempotencyRequired: false, permissions: [] })
    expect(policyOperation['x-luckread-authentication']).toContain('HMAC-SHA512')
    expect(policyOperation['x-luckread-authentication']).toContain('no browser session')
    expect(policyOperation['x-luckread-idempotency']).toContain('event_id')
    expect(policyOperation['x-luckread-idempotency']).toContain('payload SHA-256')
  })
})
