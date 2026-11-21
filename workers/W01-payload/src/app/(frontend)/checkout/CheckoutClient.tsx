'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../../lib/client-api.js'

type PaymentIntentData = {
  paymentId: string
  orderId: string
  amountMinor: number
  currency: string
  pricingMode: 'live' | 'demo'
  status: 'requires_payment_method' | 'requires_confirmation'
  version: number
  clientSecret: string
  sdkAuthorization: string
}
type ApiEnvelope = { data?: unknown; error?: { message?: unknown }; requestId?: unknown }
type HyperswitchPaymentElement = {
  mount: (selector: string) => void
  destroy?: () => void
  on: (event: string, handler: (event: unknown) => void) => void
}
type HyperswitchElements = {
  create: (type: 'payment', options?: Record<string, unknown>) => HyperswitchPaymentElement
}
type HyperswitchClient = {
  elements: (options: { clientSecret: string; locale?: string }) => HyperswitchElements
  confirmPayment: (options: {
    elements: HyperswitchElements
    confirmParams: { return_url: string }
    redirect: 'if_required'
  }) => Promise<unknown>
}

declare global {
  interface Window {
    Hyper?: (publishableKey: string) => HyperswitchClient
  }
}

const publishableKey = process.env.NEXT_PUBLIC_HYPERSWITCH_PUBLISHABLE_KEY ?? ''
const hyperswitchEnvironment = process.env.NEXT_PUBLIC_HYPERSWITCH_ENVIRONMENT ?? ''
const hyperScriptUrl = hyperswitchEnvironment === 'production'
  ? 'https://checkout.hyperswitch.io/v0/HyperLoader.js'
  : hyperswitchEnvironment === 'sandbox'
    ? 'https://beta.hyperswitch.io/v1/HyperLoader.js'
    : ''
const validOrderId = (value: string) => /^ord_[A-Za-z0-9_-]{1,90}$/.test(value)

function readPaymentIntent(value: unknown, orderId: string): PaymentIntentData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const envelope = value as ApiEnvelope
  if (typeof envelope.requestId !== 'string' || !/^req_[A-Za-z0-9_-]{1,123}$/.test(envelope.requestId)) return null
  const data = envelope.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const intent = data as Record<string, unknown>
  if (
    Object.keys(intent).length !== 9 ||
    typeof intent.paymentId !== 'string' || !/^pay_[a-f0-9]{26}$/.test(intent.paymentId) ||
    intent.orderId !== orderId ||
    typeof intent.amountMinor !== 'number' || !Number.isSafeInteger(intent.amountMinor) || intent.amountMinor <= 0 ||
    typeof intent.currency !== 'string' || !/^[A-Z]{3}$/.test(intent.currency) ||
    (intent.pricingMode !== 'live' && intent.pricingMode !== 'demo') ||
    (intent.status !== 'requires_payment_method' && intent.status !== 'requires_confirmation') ||
    typeof intent.version !== 'number' || !Number.isSafeInteger(intent.version) || intent.version < 1 ||
    typeof intent.clientSecret !== 'string' || intent.clientSecret.length < 1 ||
    intent.clientSecret.length > 4096 || intent.clientSecret.trim() !== intent.clientSecret ||
    /[\u0000-\u001f\u007f]/.test(intent.clientSecret) ||
    typeof intent.sdkAuthorization !== 'string' || intent.sdkAuthorization.length < 1 ||
    intent.sdkAuthorization.length > 4096 || intent.sdkAuthorization.trim() !== intent.sdkAuthorization ||
    /[\u0000-\u001f\u007f]/.test(intent.sdkAuthorization)
  ) return null
  return intent as PaymentIntentData
}

function money(amountMinor: number, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits
  return formatter.format(amountMinor / (10 ** fractionDigits))
}

export default function CheckoutClient({ orderId }: { orderId: string }) {
  const [intent, setIntent] = useState<PaymentIntentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sdkReady, setSdkReady] = useState(false)
  const [readyPaymentId, setReadyPaymentId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const hyperRef = useRef<HyperswitchClient | null>(null)
  const elementsRef = useRef<HyperswitchElements | null>(null)

  useEffect(() => {
    let active = true
    async function createIntent() {
      if (!validOrderId(orderId)) {
        setError('订单编号无效。')
        setLoading(false)
        return
      }
      if (!publishableKey || (hyperswitchEnvironment !== 'sandbox' && hyperswitchEnvironment !== 'production')) {
        setError('Hyperswitch 公钥或明确的 sandbox/production 环境配置缺失，支付入口已安全关闭。')
        setLoading(false)
        return
      }
      let idempotencyKey = ''
      try {
        const storageKey = 'luckread.checkout.intent.' + orderId
        idempotencyKey = window.sessionStorage.getItem(storageKey) ?? ''
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
          idempotencyKey = window.crypto.randomUUID()
          window.sessionStorage.setItem(storageKey, idempotencyKey)
        }
      } catch {
        setError('当前浏览器无法安全保留本次支付重试标识，请启用会话存储后重试。')
        setLoading(false)
        return
      }
      try {
        const response = await apiFetch('/api/v1/payments/intents', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ orderId }),
        })
        const result: unknown = await response.json().catch((): null => null)
        const envelope = result && typeof result === 'object' ? result as ApiEnvelope : null
        const parsed = response.ok ? readPaymentIntent(result, orderId) : null
        if (!response.ok || !parsed) {
          const reason = envelope?.error?.message
          throw new Error(typeof reason === 'string' ? reason : '暂时无法启动支付，请检查订单状态后重试。')
        }
        if (active) setIntent(parsed)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '暂时无法启动支付。')
      } finally {
        if (active) setLoading(false)
      }
    }
    void createIntent()
    return () => { active = false }
  }, [orderId])

  useEffect(() => {
    if (!sdkReady || !intent || !publishableKey || typeof window.Hyper !== 'function') return
    let active = true
    let paymentElement: HyperswitchPaymentElement | null = null
    try {
      const hyperClient = window.Hyper(publishableKey)
      const widgetSet = hyperClient.elements({ clientSecret: intent.clientSecret, locale: 'auto' })
      paymentElement = widgetSet.create('payment', { layout: 'tabs', displaySavedPaymentMethodsCheckbox: true, savedPaymentMethodsCheckboxCheckedByDefault: false })
      paymentElement.on('ready', () => { if (active) setReadyPaymentId(intent.paymentId) })
      paymentElement.mount('#luckread-payment-element')
      hyperRef.current = hyperClient
      elementsRef.current = widgetSet
    } catch {
      void Promise.resolve().then(() => {
        if (active) setError('Hyperswitch 支付表单初始化失败。')
      })
    }
    return () => {
      active = false
      paymentElement?.destroy?.()
      hyperRef.current = null
      elementsRef.current = null
    }
  }, [sdkReady, intent])

  async function confirmPayment() {
    const hyper = hyperRef.current
    const elements = elementsRef.current
    if (!hyper || !elements || !intent || readyPaymentId !== intent.paymentId || confirming) return
    setConfirming(true)
    setStatusMessage('')
    try {
      const returnUrl = new URL('/checkout/result', window.location.origin).toString()
      const result: unknown = await hyper.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      })
      const payload = result && typeof result === 'object' ? result as { error?: { message?: unknown } } : {}
      if (payload.error) {
        setStatusMessage(typeof payload.error.message === 'string' ? payload.error.message : '支付未完成，请核对支付方式后重试。')
      } else {
        setStatusMessage('支付已提交，最终状态仍需服务器核验；此页面不会直接开通会员权益。')
      }
    } catch {
      setStatusMessage('暂时无法提交支付，请稍后重新检查订单状态。')
    } finally {
      setConfirming(false)
    }
  }

  if (loading) return <p role="status">正在安全地准备支付…</p>
  if (error) return <section><h1>无法启动支付</h1><p role="alert">{error}</p></section>
  if (!intent) return <p role="alert">支付初始化失败，暂未创建可支付表单。</p>

  return (
    <section>
      <Script
        src={hyperScriptUrl}
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
        onError={() => setError('无法加载 Hyperswitch 官方支付 SDK。')}
      />
      <h1>安全支付</h1>
      {intent.pricingMode === 'demo' ? (
        <p role="alert" aria-live="polite">
          Demo 税务模式：本订单税额使用固定模拟税率，仅供 sandbox 流程测试，不代表真实税额，不能用于正式税务申报或生产扣款。
        </p>
      ) : null}
      <p>订单金额：{money(intent.amountMinor, intent.currency)}</p>
      <p>订单：{intent.orderId}</p>
      <div id="luckread-payment-element" aria-label="Hyperswitch 安全支付表单" />
      <p>
        如需将支付方式用于后续周期扣款，请只在 Hyperswitch 托管支付表单明确显示的“保存支付方式”选项中主动勾选授权。
        不勾选即不表示您同意保存；LuckRead 不会用自制复选框代替支付服务商的授权流程。
      </p>
      <button type="button" disabled={!intent || readyPaymentId !== intent.paymentId || confirming} onClick={() => { void confirmPayment() }}>
        {confirming ? '正在提交…' : '确认支付'}
      </button>
      {statusMessage ? <p role="status" aria-live="polite">{statusMessage}</p> : null}
      <small>支付引用：{intent.paymentId}</small>
    </section>
  )
}
