'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fetchJson } from '../../../../lib/client-api.js'

type OrderResponse = { data?: { status?: unknown }; error?: { message?: unknown } }
type ContentResponse = { data?: { accessGranted?: unknown; accessMode?: unknown }; error?: { message?: unknown } }
type VerificationState = 'checking' | 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'auth-required' | 'error'

const validOrderId = (value: string) => /^ord_[A-Za-z0-9_-]{1,90}$/.test(value)
const validContentId = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 &&
  value.trim() === value && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/.test(value)

export default function CheckoutResultClient({
  orderId,
  contentId,
}: {
  orderId: string
  contentId?: string
}) {
  const [state, setState] = useState<VerificationState>('checking')
  const [message, setMessage] = useState('正在等待服务器核验订单和会员权益。')
  const [retryNumber, setRetryNumber] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    async function verifyPurchase() {
      if (!validOrderId(orderId)) {
        setState('error')
        setMessage('订单编号无效。请从 LuckRead 订单页面重新打开。')
        return
      }
      if (contentId !== undefined && !validContentId(contentId)) {
        setState('error')
        setMessage('内容编号无效。为了保护账户和内容，不会执行跳转。')
        return
      }

      setState('checking')
      setMessage('正在核验支付结果；支付 SDK 回调本身不会开通会员权益。')

      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!active || controller.signal.aborted) return

        try {
          const orderResult = await fetchJson<OrderResponse>(
            '/api/v1/commerce/orders/' + encodeURIComponent(orderId),
            {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
              headers: { accept: 'application/json' },
              signal: controller.signal,
            },
          )
          if (!active || controller.signal.aborted) return
          if (orderResult.response.status === 401) {
            setState('auth-required')
            setMessage('请重新登录相同账号，再检查本次订单与会员权限。')
            return
          }
          if (orderResult.response.status === 403 || orderResult.response.status === 404) {
            setState('error')
            setMessage('无法核验此账号的订单。请确认你使用的是购买时的 LuckRead 账号。')
            return
          }

          const orderStatus = orderResult.data?.data?.status
          if (orderResult.response.ok &&
              ['FAILED', 'CANCELLED'].includes(String(orderStatus))) {
            setState(orderStatus === 'CANCELLED' ? 'cancelled' : 'failed')
            setMessage(orderStatus === 'CANCELLED'
              ? '订单已取消，会员权益未开通。'
              : '订单支付未成功，会员权益未开通。')
            return
          }

          if (orderResult.response.ok &&
              ['CONFIRMED', 'PROCESSING', 'COMPLETED'].includes(String(orderStatus))) {
            if (!contentId) {
              setState('confirmed')
              setMessage('服务器已确认订单。页面不会凭订单状态自行授予任何内容权益。')
              return
            }

            const contentResult = await fetchJson<ContentResponse>(
              '/api/v1/contents/' + encodeURIComponent(contentId),
              {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: { accept: 'application/json' },
                signal: controller.signal,
              },
            )
            if (!active || controller.signal.aborted) return
            if (contentResult.response.status === 401) {
              setState('auth-required')
              setMessage('订单已确认，但需要重新登录才能验证会员内容访问权限。')
              return
            }
            if (contentResult.response.ok && contentResult.data?.data?.accessGranted === true) {
              setState('confirmed')
              setMessage('服务器已确认有效会员权限，正在返回已解锁的内容。')
              window.location.replace('/content/' + encodeURIComponent(contentId))
              return
            }
            // Order confirmation can precede the webhook's idempotent
            // subscription activation. Continue checking the authoritative
            // W03 decision; never substitute the order status for entitlement.
          }
        } catch {
          if (!active || controller.signal.aborted) return
          // Transient network or service errors retry within the bounded window.
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 2000)
        })
      }

      if (active && !controller.signal.aborted) {
        setState('pending')
        setMessage('服务器仍未确认会员内容权限。请稍后重试；在 W03 明确授权前，内容会继续保持锁定。')
      }
    }

    void verifyPurchase()
    return () => {
      active = false
      controller.abort()
    }
  }, [orderId, contentId, retryNumber])

  return (
    <section aria-live="polite">
      <h1>支付结果核验</h1>
      <p role={state === 'error' || state === 'failed' || state === 'cancelled' ? 'alert' : 'status'}>
        {message}
      </p>
      {state === 'checking' ? <p>订单读取由 W07 负责，内容访问决定由 W03 负责。</p> : null}
      {state === 'pending' ? (
        <button type="button" onClick={() => setRetryNumber((value) => value + 1)}>
          重新核验
        </button>
      ) : null}
      {state === 'auth-required' ? (
        <Link href={'/login?returnTo=' + encodeURIComponent('/checkout/result?orderId=' + orderId + (contentId ? '&contentId=' + contentId : ''))}>
          重新登录
        </Link>
      ) : null}
      {state === 'confirmed' && !contentId ? (
        <p>如购买的是会员套餐，请从对应内容页面再次打开；页面会重新读取 W03 的授权结果。</p>
      ) : null}
      <p>
        <Link href={contentId && validContentId(contentId) ? '/content/' + encodeURIComponent(contentId) : '/me/subscriptions'}>
          {contentId ? '返回内容页面' : '查看我的订阅'}
        </Link>
      </p>
      <small>订单：{validOrderId(orderId) ? orderId : '无效订单'}</small>
    </section>
  )
}
