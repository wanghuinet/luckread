import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('checkout return verifies authoritative membership entitlement', () => {
  it('carries order/content context and always enters server verification after a non-error provider result', () => {
    const checkout = read('src/app/(frontend)/checkout/CheckoutClient.tsx')
    const checkoutPage = read('src/app/(frontend)/checkout/page.tsx')
    const membershipPage = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')

    expect(membershipPage).toContain("'&contentId=' + encodeURIComponent(content.id)")
    expect(checkoutPage).toContain("const contentId = typeof query.contentId === 'string' ? query.contentId : undefined")
    expect(checkoutPage).toContain('<CheckoutClient orderId={orderId} contentId={contentId} />')
    expect(checkout).toContain("resultUrl.searchParams.set('orderId', intent.orderId)")
    expect(checkout).toContain("resultUrl.searchParams.set('contentId', contentId)")
    expect(checkout).toContain("redirect: 'if_required'")
    expect(checkout).toContain('window.location.assign(returnUrl)')
    expect(checkout).not.toContain('setStatusMessage(\'支付已提交，最终状态仍需服务器核验；此页面不会直接开通会员权益。\')')
  })

  it('requires a confirmed owner-scoped order and W03 accessGranted decision before redirecting to content', () => {
    const resultPage = read('src/app/(frontend)/checkout/result/page.tsx')
    const resultClient = read('src/app/(frontend)/checkout/result/CheckoutResultClient.tsx')

    expect(resultPage).toContain('CheckoutResultClient orderId={orderId} contentId={contentId}')
    expect(resultClient).toContain("'/api/v1/commerce/orders/' + encodeURIComponent(orderId)")
    expect(resultClient).toContain("['CONFIRMED', 'PROCESSING', 'COMPLETED']")
    expect(resultClient).toContain("'/api/v1/contents/' + encodeURIComponent(contentId)")
    expect(resultClient).toContain('contentResult.data?.data?.accessGranted === true')
    expect(resultClient).toContain("window.location.replace('/content/' + encodeURIComponent(contentId))")
    expect(resultClient).toContain("cache: 'no-store'")
    expect(resultClient).not.toContain('accessGranted: true')
    expect(resultClient).not.toContain('INSERT INTO membership_subscriptions')
  })
})
