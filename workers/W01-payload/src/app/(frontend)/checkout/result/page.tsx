'use client'

import { useCallback, useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'

type PaymentStatus =
  | 'INITIATING'
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_customer_action'
  | 'requires_merchant_action'
  | 'requires_capture'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'cancelled_post_capture'
  | 'partially_captured'
  | 'partially_captured_and_capturable'
  | 'expired'

type PaymentStatusData = {
  payment: {
    paymentId: string
    orderId: string
    amountMinor: number
    currency: string
    status: PaymentStatus
    version: number
    providerUpdatedAt: string | null
    createdAt: string
    updatedAt: string
  }
  providerStatus: Exclude<PaymentStatus, 'INITIATING'> | null
  providerStatusCheck: 'MATCH' | 'DIFFERS' | 'UNAVAILABLE'
  providerCheckedAt: string | null
  statusAuthority: 'W07_D1_04'
}

type PaymentStatusEnvelope = {
  data?: PaymentStatusData
  requestId?: string
  error?: { code?: string; message?: string }
}

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/
const STATUS_LABELS: Record<PaymentStatus, string> = {
  INITIATING: '支付请求已建立，等待服务商处理',
  requires_payment_method: '等待付款方式确认',
  requires_confirmation: '等待支付确认',
  requires_customer_action: '需要完成支付验证',
  requires_merchant_action: '等待商户处理',
  requires_capture: '等待完成扣款',
  processing: '支付处理中',
  succeeded: '支付成功（W07 已保存服务端状态）',
  failed: '支付失败',
  cancelled: '支付已取消',
  cancelled_post_capture: '扣款后已取消，需要进一步核对',
  partially_captured: '已部分扣款',
  partially_captured_and_capturable: '已部分扣款，仍有可扣款余额',
  expired: '支付已过期',
}

const formatDate = (value: string | null): string => {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '—'
}

const formatMoney = (amountMinor: number, currency: string): string => {
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    return formatter.format(amountMinor / (10 ** formatter.resolvedOptions().maximumFractionDigits))
  } catch {
    return String(amountMinor) + ' ' + currency
  }
}

function isPaymentStatusData(value: unknown, expectedId: string): value is PaymentStatusData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  if (
    data.statusAuthority !== 'W07_D1_04' ||
    !data.payment || typeof data.payment !== 'object' || Array.isArray(data.payment) ||
    !['MATCH', 'DIFFERS', 'UNAVAILABLE'].includes(String(data.providerStatusCheck)) ||
    !(data.providerCheckedAt === null || (typeof data.providerCheckedAt === 'string' && Number.isFinite(Date.parse(data.providerCheckedAt))))
  ) return false
  const payment = data.payment as Record<string, unknown>
  const statuses = Object.keys(STATUS_LABELS)
  if (
    payment.paymentId !== expectedId ||
    typeof payment.orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(payment.orderId) ||
    typeof payment.amountMinor !== 'number' || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0 ||
    typeof payment.currency !== 'string' || !/^[A-Z]{3}$/.test(payment.currency) ||
    typeof payment.status !== 'string' || !statuses.includes(payment.status) ||
    typeof payment.version !== 'number' || !Number.isSafeInteger(payment.version) || payment.version < 1 ||
    !(payment.providerUpdatedAt === null || (typeof payment.providerUpdatedAt === 'string' && Number.isFinite(Date.parse(payment.providerUpdatedAt)))) ||
    typeof payment.createdAt !== 'string' || !Number.isFinite(Date.parse(payment.createdAt)) ||
    typeof payment.updatedAt !== 'string' || !Number.isFinite(Date.parse(payment.updatedAt))
  ) return false

  const providerStatus = data.providerStatus
  if (!(providerStatus === null || (typeof providerStatus === 'string' && statuses.includes(providerStatus) && providerStatus !== 'INITIATING'))) {
    return false
  }
  if (data.providerStatusCheck === 'MATCH' && (providerStatus === null || providerStatus !== payment.status || data.providerCheckedAt === null)) return false
  if (data.providerStatusCheck === 'DIFFERS' && (providerStatus === null || providerStatus === payment.status || data.providerCheckedAt === null)) return false
  if (data.providerStatusCheck === 'UNAVAILABLE' && providerStatus !== null) return false
  return true
}

export default function CheckoutResultPage() {
  const [paymentId, setPaymentId] = useState('')
  const [payment, setPayment] = useState<PaymentStatusData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setPaymentId(params.get('paymentId') ?? '')
  }, [])

  const load = useCallback(async () => {
    if (!PAYMENT_ID_PATTERN.test(paymentId)) {
      setError('支付编号不存在或格式无效。请从结账页面重新打开支付状态查询。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<PaymentStatusEnvelope>(
        '/api/v1/payments/' + encodeURIComponent(paymentId),
        { credentials: 'include', cache: 'no-store' },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        throw new Error(data?.error?.message || getApiErrorMessage(data, '无法读取支付状态。', response.status))
      }
      if (
        typeof data?.requestId !== 'string' ||
        !/^req_[A-Za-z0-9_-]{1,123}$/.test(data.requestId) ||
        !isPaymentStatusData(data.data, paymentId)
      ) {
        throw new Error('支付状态响应无法验证，请稍后重试。')
      }
      setPayment(data.data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取支付状态。')
    } finally {
      setLoading(false)
    }
  }, [paymentId])

  useEffect(() => {
    if (paymentId) void load()
  }, [paymentId, load])

  const authoritativeStatus = payment?.payment.status ?? null

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8" aria-busy={loading}>
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-main-accent">LUCKREAD · PAYMENT</p>
        <h1 className="mt-2 text-2xl font-extrabold">支付状态查询</h1>
        <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">
          这里读取的是服务器支付记录。浏览器跳转、SDK 回调和服务商查询结果都不会直接开通会员权益。
        </p>
      </header>

      {!paymentId ? (
        <p className="rounded-xl border border-light-border px-4 py-4 text-sm dark:border-dark-border" role="alert">
          没有收到支付编号。请从结账页面进入状态查询。
        </p>
      ) : null}

      {error ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-900 dark:bg-rose-950/30" role="alert">
          <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
          <button type="button" disabled={loading} onClick={() => void load()} className="mt-3 text-sm font-bold text-main-accent disabled:opacity-50">
            重试查询
          </button>
        </section>
      ) : null}

      {loading && !payment ? <p role="status" className="text-sm text-light-secondary">正在读取服务器支付记录…</p> : null}

      {payment ? (
        <section className="rounded-2xl border border-light-border bg-white p-5 dark:border-dark-border dark:bg-dark-bg">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-light-secondary dark:text-dark-secondary">LuckRead 保存的支付状态</p>
              <h2 className="mt-2 text-lg font-extrabold">{STATUS_LABELS[authoritativeStatus!]}</h2>
            </div>
            <span className="rounded-full border border-light-border px-3 py-1 text-xs font-bold dark:border-dark-border">
              D1-04 · W07
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-light-border pt-4 dark:border-dark-border sm:grid-cols-2">
            <div>
              <dt className="text-xs text-light-secondary dark:text-dark-secondary">金额</dt>
              <dd className="mt-1 text-lg font-extrabold">{formatMoney(payment.payment.amountMinor, payment.payment.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-light-secondary dark:text-dark-secondary">订单编号</dt>
              <dd className="mt-1 break-all text-sm font-semibold">{payment.payment.orderId}</dd>
            </div>
            <div>
              <dt className="text-xs text-light-secondary dark:text-dark-secondary">支付编号</dt>
              <dd className="mt-1 break-all text-sm font-semibold">{payment.payment.paymentId}</dd>
            </div>
            <div>
              <dt className="text-xs text-light-secondary dark:text-dark-secondary">记录版本</dt>
              <dd className="mt-1 text-sm font-semibold">v{payment.payment.version}</dd>
            </div>
            <div>
              <dt className="text-xs text-light-secondary dark:text-dark-secondary">服务器最后更新</dt>
              <dd className="mt-1 text-sm">{formatDate(payment.payment.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-light-secondary dark:text-dark-secondary">已保存服务商更新时间</dt>
              <dd className="mt-1 text-sm">{formatDate(payment.payment.providerUpdatedAt)}</dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-light-border pt-4 dark:border-dark-border">
            <p className="text-xs font-bold text-light-secondary dark:text-dark-secondary">Hyperswitch 即时状态观察</p>
            <p className="mt-2 text-sm font-semibold">
              {payment.providerStatus ? STATUS_LABELS[payment.providerStatus] : '暂时不可用'}
            </p>
            {payment.providerStatusCheck === 'MATCH' ? (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">服务商观察状态与 W07 已保存状态一致。</p>
            ) : payment.providerStatusCheck === 'DIFFERS' ? (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300" role="status">
                服务商观察状态与 W07 已保存状态不同。系统以 D1-04 已保存状态为准，等待签名事件核对；不会仅凭服务商查询结果或浏览器回调发放权益。
              </p>
            ) : (
              <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">
                暂时无法获取服务商即时状态。上方仍显示 W07 D1-04 最后一次保存的状态。
              </p>
            )}
            <p className="mt-2 text-xs text-light-secondary dark:text-dark-secondary">
              服务商检查时间：{formatDate(payment.providerCheckedAt)}
            </p>
          </div>

          {payment.payment.status === 'succeeded' ? (
            <p className="mt-4 rounded-xl bg-light-primary/5 px-3 py-3 text-sm leading-6 dark:bg-dark-primary/5">
              W07 已保存支付成功状态。会员内容权益仍由后端订阅与权益流程决定；本页面不会直接授予权限。
            </p>
          ) : (
            <p className="mt-4 rounded-xl bg-light-primary/5 px-3 py-3 text-sm leading-6 dark:bg-dark-primary/5">
              在服务器核验完成前，请勿仅凭跳转成功重复付款或自行判断会员权益已经生效。
            </p>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="mt-5 rounded-full border border-light-border px-5 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border"
          >
            {loading ? '正在刷新…' : '刷新支付状态'}
          </button>
        </section>
      ) : null}
    </main>
  )
}
