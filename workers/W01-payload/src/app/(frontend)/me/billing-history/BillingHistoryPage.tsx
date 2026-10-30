'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import type { PublicLocale } from '../../i18n/public-locale'

type OrderStatus = 'CREATED' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
type OrderSummary = {
  orderId: string
  status: OrderStatus
  version: number
  currency: string
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
  createdAt: string
  updatedAt: string
}
type OrderPage = { items: OrderSummary[]; limit: number; hasMore: boolean; nextCursor: string | null }
type OrderResponse = { data?: OrderPage; error?: { code?: string; message?: string }; requestId?: string }

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      title: 'Billing and orders',
      refresh: 'Refresh',
      description: 'Private order summaries for your account. An order record is not a tax invoice and does not by itself prove payment success or content entitlement.',
      loading: 'Loading order history…',
      empty: 'No orders yet',
      emptyBody: 'Your orders will appear here after an order has been created.',
      error: 'Could not load order history.',
      retry: 'Retry',
      loadMore: 'Load more orders',
      loadingMore: 'Loading…',
      order: 'Order',
      amount: 'Order amount',
      created: 'Created',
      status: {
        CREATED: 'Created',
        PENDING_PAYMENT: 'Pending payment',
        CONFIRMED: 'Confirmed',
        PROCESSING: 'Processing',
        COMPLETED: 'Completed',
        CANCELLED: 'Cancelled',
        FAILED: 'Failed',
      },
    }
  : locale === 'tw'
    ? {
        title: '帳單與訂單',
        refresh: '重新整理',
        description: '僅顯示目前帳戶擁有的訂單摘要。訂單記錄不是稅務發票，也不能單獨證明付款成功或內容權益已生效。',
        loading: '正在讀取訂單記錄…',
        empty: '目前沒有訂單',
        emptyBody: '建立訂單後，記錄會顯示在這裡。',
        error: '無法讀取訂單記錄。',
        retry: '重試',
        loadMore: '載入更多訂單',
        loadingMore: '載入中…',
        order: '訂單',
        amount: '訂單金額',
        created: '建立時間',
        status: {
          CREATED: '已建立',
          PENDING_PAYMENT: '待付款',
          CONFIRMED: '已確認',
          PROCESSING: '處理中',
          COMPLETED: '已完成',
          CANCELLED: '已取消',
          FAILED: '失敗',
        },
      }
    : {
        title: '账单与订单',
        refresh: '刷新',
        description: '仅显示当前账户拥有的订单摘要。订单记录不是税务发票，也不能单独证明付款成功或内容权益已生效。',
        loading: '正在读取订单记录…',
        empty: '暂无订单记录',
        emptyBody: '创建订单后，记录会显示在这里。',
        error: '订单记录读取失败。',
        retry: '重试',
        loadMore: '加载更多订单',
        loadingMore: '加载中…',
        order: '订单',
        amount: '订单金额',
        created: '创建时间',
        status: {
          CREATED: '已创建',
          PENDING_PAYMENT: '待付款',
          CONFIRMED: '已确认',
          PROCESSING: '处理中',
          COMPLETED: '已完成',
          CANCELLED: '已取消',
          FAILED: '失败',
        },
      }

const isOrderSummary = (value: unknown): value is OrderSummary => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const statuses = ['CREATED', 'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED']
  return typeof item.orderId === 'string' && /^ord_[A-Za-z0-9_-]{1,90}$/.test(item.orderId) &&
    typeof item.status === 'string' && statuses.includes(item.status) &&
    Number.isSafeInteger(item.version) && Number(item.version) >= 1 &&
    typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency) &&
    ['subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor'].every((key) =>
      Number.isSafeInteger(item[key]) && Number(item[key]) >= 0) &&
    typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) &&
    typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
}

const formatDate = (value: string, locale: PublicLocale) => {
  const timestamp = Date.parse(value)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString(dateLocale) : '—'
}

const formatMoney = (amountMinor: number, currency: string, locale: PublicLocale) => {
  const numberLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  try {
    const formatter = new Intl.NumberFormat(numberLocale, { style: 'currency', currency })
    const exponent = formatter.resolvedOptions().maximumFractionDigits
    return formatter.format(amountMinor / (10 ** exponent))
  } catch {
    return String(amountMinor) + ' ' + currency
  }
}

export default function BillingHistoryPage() {
  const locale = usePublicLocale()
  const labels = copy(locale)
  const [items, setItems] = useState<OrderSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const activeRequestRef = useRef<AbortController | null>(null)

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const query = new URLSearchParams({ limit: '20' })
      if (cursor) query.set('cursor', cursor)
      const { response, data } = await fetchJson<OrderResponse>(
        '/api/v1/commerce/orders?' + query.toString(),
        { signal: controller.signal, credentials: 'include', cache: 'no-store' },
      )
      if (controller.signal.aborted) return
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        throw new Error(data?.error?.message || getApiErrorMessage(data, labels.error, response.status))
      }
      const page = data?.data
      if (
        !page || !Array.isArray(page.items) ||
        !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50 ||
        typeof page.hasMore !== 'boolean' ||
        !(page.nextCursor === null || (typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 2048)) ||
        !page.items.every(isOrderSummary)
      ) {
        throw new Error(labels.error)
      }
      setItems((current) => {
        if (!append) return page.items
        const known = new Set(current.map((item) => item.orderId))
        return [...current, ...page.items.filter((item) => !known.has(item.orderId))]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : labels.error)
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null
      if (!controller.signal.aborted) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [labels.error])

  useEffect(() => {
    void load()
    return () => activeRequestRef.current?.abort()
  }, [load])

  return (
    <section className="flex flex-col" aria-busy={loading || loadingMore}>
      <header className="border-b border-light-border px-4 py-4 dark:border-dark-border">
        <h2 className="text-base font-bold">{labels.title}</h2>
        <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.description}</p>
        <button
          type="button"
          disabled={loading || loadingMore}
          onClick={() => void load()}
          className="mt-3 rounded-full border border-light-border px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border"
        >
          {loading ? labels.loadingMore : labels.refresh}
        </button>
      </header>
      {error ? (
        <div className="flex items-center justify-between gap-3 border-b border-light-border px-4 py-3 text-sm dark:border-dark-border" role="alert">
          <span className="text-rose-700 dark:text-rose-300">{error}</span>
          <button type="button" className="font-bold text-main-accent" onClick={() => void load()}>{labels.retry}</button>
        </div>
      ) : null}
      {loading && items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.loading}</p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <section className="px-6 py-14">
          <strong className="text-xl font-bold">{labels.empty}</strong>
          <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">{labels.emptyBody}</p>
        </section>
      ) : null}
      {items.map((item) => (
        <article className="border-b border-light-border px-4 py-4 dark:border-dark-border" key={item.orderId}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-light-secondary dark:text-dark-secondary">{labels.order}</p>
              <p className="mt-1 break-all text-sm font-bold">{item.orderId}</p>
            </div>
            <span className="shrink-0 rounded-full bg-light-line-reply px-3 py-1 text-xs font-bold dark:bg-dark-line-reply">
              {labels.status[item.status]}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-light-border pt-3 dark:border-dark-border sm:grid-cols-2">
            <div>
              <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.amount}</dt>
              <dd className="mt-1 text-base font-extrabold">{formatMoney(item.totalMinor, item.currency, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.created}</dt>
              <dd className="mt-1 text-sm font-medium">{formatDate(item.createdAt, locale)}</dd>
            </div>
          </dl>
        </article>
      ))}
      {hasMore && nextCursor ? (
        <div className="flex justify-center px-4 py-5">
          <button
            className="rounded-full border border-light-border px-5 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border"
            disabled={loadingMore}
            onClick={() => void load(nextCursor, true)}
            type="button"
          >
            {loadingMore ? labels.loadingMore : labels.loadMore}
          </button>
        </div>
      ) : null}
    </section>
  )
}
