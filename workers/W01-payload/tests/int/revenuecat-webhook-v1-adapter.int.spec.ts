import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/webhooks/revenuecat/route.ts'), 'utf8')
const client = readFileSync(resolve(process.cwd(), 'src/subscription/w07-subscription-client.ts'), 'utf8')
const bodyReader = readFileSync(resolve(process.cwd(), 'src/subscription/provider-webhook-body.ts'), 'utf8')
const receiver = readFileSync(resolve(process.cwd(), '../../workers/W07-subscription-commerce/src/revenuecat-webhook-http-runtime.ts'), 'utf8')
const signature = readFileSync(resolve(process.cwd(), '../../workers/W07-subscription-commerce/src/revenuecat-webhook-signature.ts'), 'utf8')
const persistence = readFileSync(resolve(process.cwd(), '../../workers/W07-subscription-commerce/src/revenuecat-webhook-persistence.ts'), 'utf8')
const migration = readFileSync(resolve(process.cwd(), '../../workers/W07-subscription-commerce/migrations-d1-04/0005_revenuecat_webhook_inbox.sql'), 'utf8')
const openapi = readFileSync(resolve(process.cwd(), '../../contracts/openapi/v1/openapi.yaml'), 'utf8')
const inventory = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/api/api-inventory.v1.json'), 'utf8'))
const transport = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'), 'utf8'))
const policy = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/openapi/v1/operation-policy.json'), 'utf8'))

describe('RevenueCat provider webhook ingress', () => {
  it('reuses the shared raw-body reader and keeps the public route sessionless', () => {
    expect(route).toContain('readBoundedProviderWebhookBody(request, errorResponse)')
    expect(route).toContain('forwardW07RevenueCatWebhook({ request, rawBody })')
    expect(route).not.toContain('resolveCookieSubscriptionPrincipal')
    expect(route).not.toContain('request.json()')
    expect(route).not.toContain('JSON.stringify')
    expect(bodyReader).toContain('MAX_PROVIDER_WEBHOOK_BODY_BYTES = 1024 * 1024')
    expect(bodyReader).toContain('request.body.getReader()')
  })

  it('forwards only the dashboard Authorization and optional HMAC header over W01 service binding', () => {
    expect(client).toContain('/internal/webhooks/revenuecat')
    expect(client).toContain("input.request.headers.get('Authorization')")
    expect(client).toContain("input.request.headers.get('X-RevenueCat-Webhook-Signature')")
    expect(client).toContain('body: input.rawBody')
    expect(client).toContain("'X-LuckRead-Caller': 'W01'")
    expect(client).not.toContain("headers.set('Cookie'")
    expect(client).not.toContain("headers.set('cookie'")
    expect(client).not.toContain('input.request.headers.forEach')
  })

  it('requires W01 transport, compares Authorization, and conditionally verifies HMAC in W07', () => {
    expect(receiver).toContain("request.headers.get('X-LuckRead-Caller') !== 'W01'")
    expect(receiver).toContain("request.headers.get('X-LuckRead-Transport-Version') !== '1.0'")
    expect(receiver).toContain('verifyRevenueCatAuthorization')
    expect(receiver).toContain('if (env.REVENUECAT_WEBHOOK_SIGNING_SECRET)')
    expect(receiver).toContain('verifyRevenueCatWebhookSignature')
    expect(signature).toContain('crypto.subtle.importKey')
    expect(signature).toContain('constantTimeBytesEqual')
    expect(receiver).toContain('REVENUECAT_ALLOWED_APP_IDS')
  })

  it('deduplicates app/event identity and retains changed-payload conflicts without granting access', () => {
    expect(persistence).toContain('sha256BytesToHex')
    expect(persistence).toContain('ON CONFLICT(app_id,event_id) DO NOTHING')
    expect(persistence).toContain('revenuecat_webhook_event_conflicts')
    expect(migration).toContain('UNIQUE (app_id, event_id)')
    expect(migration).toContain('revenuecat_webhook_events_identity_immutable')
    expect(migration).toContain('revenuecat_webhook_conflicts_reference_first_receipt')
    expect(receiver).toContain('entitlementApplied: false')
    expect(receiver).not.toContain('createSubscription(')
    expect(receiver).not.toContain('grantSubscriptionEntitlement')
  })

  it('contracts the public W01 path and private W07 path with no user principal requirement', () => {
    expect(inventory.domains.subscription_entitlement_payment.endpoint_groups)
      .toContain('POST /v1/webhooks/revenuecat')
    expect(openapi).toContain('operationId: receiveRevenueCatWebhook')
    expect(openapi).toContain('name: X-RevenueCat-Webhook-Signature')
    const operation = transport.operations.find((item: { operationId: string }) => item.operationId === 'receiveRevenueCatWebhook')
    expect(operation).toMatchObject({
      publicPath: '/api/v1/webhooks/revenuecat',
      internalPath: '/internal/webhooks/revenuecat',
      principalRequired: false,
      rawBodyPreserved: true,
      maximumBodyBytes: 1048576,
    })
    const policyOperation = policy.operations.find((item: { operationId: string }) => item.operationId === 'receiveRevenueCatWebhook')
    expect(policyOperation).toMatchObject({ auth: { mode: 'public' }, idempotencyRequired: false, permissions: [] })
    expect(policyOperation['x-luckread-authentication']).toContain('Authorization')
    expect(policyOperation['x-luckread-authentication']).toContain('HMAC-SHA256')
  })
})
