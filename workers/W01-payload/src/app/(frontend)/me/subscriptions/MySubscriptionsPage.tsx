'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import type { PublicLocale } from '../../i18n/public-locale'

type Subscription = {
  subscriptionId: string
  planId: string
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED'
  creatorId?: string | null
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAt?: string | null
  etag: string
}

type ListResponse = {
  data?: {
    docs?: Subscription[]
    hasNextPage?: boolean
    page?: number
    limit?: number
  }
  error?: { code?: string; message?: string }
}
type SavedPaymentMethod = {
  savedPaymentMethodId: string
  paymentMethod: string
  paymentMethodType: string | null
  brand: string | null
  last4: string | null
  expiryMonth: string | null
  expiryYear: string | null
  createdAt: string
  recurringEnabled: boolean
  mandateStatus: 'ACTIVE' | 'PENDING_PROVIDER_CONFIRMATION' | 'REVOKED' | 'FAILED' | 'EXPIRED' | 'NONE'
  status: 'ACTIVE' | 'SETUP_PENDING' | 'NO_RECURRING' | 'REVOCATION_PENDING'
}

type PaymentMethodListResponse = {
  data?: { docs?: SavedPaymentMethod[] }
  error?: { code?: string; message?: string }
}

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      eyebrow: 'LUCKREAD · MEMBERSHIP',
      description: 'Review subscription status and billing periods. Subscription records do not prove payment completion or access entitlement. Pause, resume, and cancellation are temporarily unavailable until verified payment-provider synchronization is admitted.',
      discover: 'Explore content',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading subscriptions…',
      emptyTitle: 'No subscriptions yet',
      emptyBody: 'Your subscription records will appear here when available.',
      plan: 'Plan',
      creator: 'Creator subscription',
      membership: 'Membership subscription',
      viewCreator: 'View creator profile',
      id: 'Subscription ID',
      period: 'Current period',
      cancelAt: 'Cancellation date',
      mutationsUnavailable: 'Subscription changes are temporarily unavailable while verified payment-provider synchronization is being admitted. Your status and billing-period records remain available.',
      loadMore: 'Load more subscriptions',
      loadingMore: 'Loading more…',
      loadError: 'Could not load subscriptions.',
      updateError: 'Could not update subscription.',
      sessionExpired: 'Your session has expired. Sign in again.',
      paymentMethodsTitle: 'Saved payment methods',
      paymentMethodsEmpty: 'No saved payment methods yet.',
      paymentMethodsLoading: 'Loading saved payment methods…',
      removePaymentMethod: 'Remove',
      retryRemoval: 'Retry removal',
      activeMandate: 'Recurring authorization active',
      setupPending: 'Provider authorization pending',
      revocationPending: 'Removal pending · new automatic charges are paused',
      noRecurring: 'No active automatic-renewal authorization',
      removeConfirm: 'Removing this method blocks new automatic renewal charges and requests provider-side mandate revocation. Existing payments are not refunded.',
      removalAccepted: 'Removal is pending provider confirmation. New automatic charges remain paused until signed confirmation arrives.',
      removalComplete: 'The provider confirmed that this payment method was removed.',
      paymentMethodError: 'Could not load or remove saved payment methods.',
      status: {
        PENDING: 'Pending',
        ACTIVE: 'Active',
        PAST_DUE: 'Past due',
        PAUSED: 'Paused',
        CANCELED: 'Canceled',
        EXPIRED: 'Expired',
      },
    }
  : locale === 'tw'
    ? {
        eyebrow: 'LUCKREAD · 會員訂閱',
        description: '查看訂閱狀態與週期。訂閱記錄本身不代表付款完成或已取得內容權益；暫停、恢復及取消操作將在付款服務商同步驗證通過後開放。',
        discover: '探索內容',
        refresh: '重新整理',
        refreshing: '正在重新整理…',
        loading: '正在讀取訂閱…',
        emptyTitle: '目前沒有訂閱記錄',
        emptyBody: '建立訂閱後，相關記錄會顯示在這裡。',
        plan: '方案',
        creator: '創作者訂閱',
        membership: '會員訂閱',
        viewCreator: '查看創作者主页',
        id: '訂閱 ID',
        period: '目前週期',
        cancelAt: '取消時間',
        mutationsUnavailable: '付款服務商同步驗證尚未通過，暫時無法變更訂閱；目前仍可查看狀態與週期記錄。',
        loadMore: '載入更多訂閱',
        loadingMore: '載入中…',
        loadError: '無法讀取訂閱。',
        updateError: '無法更新訂閱狀態。',
        sessionExpired: '登入已失效，請重新登入。',
        paymentMethodsTitle: '已儲存的付款方式',
        paymentMethodsEmpty: '目前沒有已儲存的付款方式。',
        paymentMethodsLoading: '正在讀取付款方式…',
        removePaymentMethod: '移除',
        retryRemoval: '重試移除',
        activeMandate: '自動續費授權有效',
        setupPending: '等待支付渠道確認授權',
        revocationPending: '移除處理中 · 已暫停新的自動扣款',
        noRecurring: '目前沒有有效的自動續費授權',
        removeConfirm: '移除後會阻止新的自動續費扣款並請求支付渠道撤銷授權。已完成的付款不會退款。',
        removalAccepted: '支付渠道確認仍在處理。簽名確認到達前，新的自動扣款會維持暫停。',
        removalComplete: '支付渠道已確認移除這項付款方式。',
        paymentMethodError: '無法讀取或移除已儲存的付款方式。',
        status: {
          PENDING: '待處理',
          ACTIVE: '有效',
          PAST_DUE: '逾期',
          PAUSED: '已暫停',
          CANCELED: '已取消',
          EXPIRED: '已到期',
        },
      }
    : {
        eyebrow: 'LUCKREAD · 会员订阅',
        description: '查看订阅状态与周期。订阅记录不代表付款完成或内容权益；暂停、恢复与取消操作将在付款服务商同步验证通过后开放。',
        discover: '发现内容',
        refresh: '刷新',
        refreshing: '刷新中…',
        loading: '正在读取订阅…',
        emptyTitle: '还没有订阅记录',
        emptyBody: '建立订阅后，相关记录会显示在这里。',
        plan: '方案',
        creator: '创作者订阅',
        membership: '会员订阅',
        viewCreator: '查看创作者主页',
        id: '订阅 ID',
        period: '当前周期',
        cancelAt: '取消时间',
        mutationsUnavailable: '付款服务商同步验证尚未通过，暂时无法变更订阅；目前仍可查看状态与周期记录。',
        loadMore: '加载更多订阅',
        loadingMore: '加载中…',
        loadError: '订阅读取失败。',
        updateError: '订阅状态更新失败。',
        sessionExpired: '登录已失效，请重新登录。',
        paymentMethodsTitle: '已保存的付款方式',
        paymentMethodsEmpty: '目前没有已保存的付款方式。',
        paymentMethodsLoading: '正在读取付款方式…',
        removePaymentMethod: '移除',
        retryRemoval: '重试移除',
        activeMandate: '自动续费授权有效',
        setupPending: '等待支付渠道确认授权',
        revocationPending: '移除处理中 · 已暂停新的自动扣款',
        noRecurring: '当前没有有效的自动续费授权',
        removeConfirm: '移除后会阻止新的自动续费扣款并请求支付渠道撤销授权。已完成的付款不会退款。',
        removalAccepted: '支付渠道仍在处理确认。签名确认到达前，新的自动扣款会保持暂停。',
        removalComplete: '支付渠道已确认移除该付款方式。',
        paymentMethodError: '无法读取或移除已保存的付款方式。',
        status: {
          PENDING: '待处理',
          ACTIVE: '有效',
          PAST_DUE: '逾期',
          PAUSED: '已暂停',
          CANCELED: '已取消',
          EXPIRED: '已到期',
        },
      }

const formatDate = (value: string, locale: PublicLocale) => {
  const time = Date.parse(value)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(dateLocale) : '—'
}

const statusClass = (status: Subscription['status']) => {
  if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
  if (status === 'PAST_DUE') return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
  if (status === 'PAUSED') return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
  return 'bg-light-line-reply text-light-secondary dark:bg-dark-line-reply dark:text-dark-secondary'
}

export default function MySubscriptionsPage() {
  const locale = usePublicLocale()
  const labels = copy(locale)
  const [items, setItems] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [paymentMethods, setPaymentMethods] = useState<SavedPaymentMethod[]>([])
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(true)
  const [paymentMethodError, setPaymentMethodError] = useState('')
  const [removingPaymentMethodId, setRemovingPaymentMethodId] = useState<string | null>(null)
  const paymentMethodIdempotencyKeys = useRef(new Map<string, string>())

  async function load(page = 1, append = false) {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<ListResponse>('/api/v1/memberships/subscriptions?limit=20&page=' + String(page), {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !Array.isArray(data?.data?.docs)) {
        throw new Error(getApiErrorMessage(data, labels.loadError))
      }
      setItems((current) => append ? [...current, ...(data.data?.docs ?? [])] : (data.data?.docs ?? []))
      setPageNumber(data.data?.page ?? page)
      setHasNextPage(data.data?.hasNextPage === true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  async function loadPaymentMethods() {
    setPaymentMethodsLoading(true)
    setPaymentMethodError('')
    try {
      const { response, data } = await fetchJson<PaymentMethodListResponse>('/api/v1/payment-methods', {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !Array.isArray(data?.data?.docs)) {
        throw new Error(getApiErrorMessage(data, labels.paymentMethodError))
      }
      const records = data.data.docs
      if (!records.every((item) =>
        item && typeof item.savedPaymentMethodId === 'string' &&
        /^spm_[A-Za-z0-9]{26}$/.test(item.savedPaymentMethodId) &&
        typeof item.paymentMethod === 'string' &&
        ['ACTIVE', 'SETUP_PENDING', 'NO_RECURRING', 'REVOCATION_PENDING'].includes(item.status)
      )) throw new Error(labels.paymentMethodError)
      setPaymentMethods(records)
    } catch (caught) {
      setPaymentMethodError(caught instanceof Error ? caught.message : labels.paymentMethodError)
      // The first request may have durably blocked MIT even when provider
      // replay fails; refresh the authoritative status instead of showing stale ACTIVE.
      void loadPaymentMethods()
    } finally {
      setPaymentMethodsLoading(false)
    }
  }

  async function removePaymentMethod(method: SavedPaymentMethod) {
    const confirmText = labels.removeConfirm + '\n\n' +
      (method.brand || method.paymentMethod) + (method.last4 ? ' •••• ' + method.last4 : '')
    if (!window.confirm(confirmText)) return
    let idempotencyKey = paymentMethodIdempotencyKeys.current.get(method.savedPaymentMethodId)
    if (!idempotencyKey) {
      idempotencyKey = 'remove_' + method.savedPaymentMethodId
      paymentMethodIdempotencyKeys.current.set(method.savedPaymentMethodId, idempotencyKey)
    }
    setRemovingPaymentMethodId(method.savedPaymentMethodId)
    setPaymentMethodError('')
    try {
      const sendRemoval = () => fetchJson<unknown>(
        '/api/v1/payment-methods/' + encodeURIComponent(method.savedPaymentMethodId),
        {
          method: 'DELETE',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
        },
      )
      let result = await sendRemoval()
      // A 202 with replayed=false means this request only created the durable
      // MIT block. Replay exactly once to perform provider I/O in a new request.
      const firstStage = result.data && typeof result.data === 'object'
        ? (result.data as { data?: { replayed?: unknown } }).data
        : undefined
      if (result.response.status === 202 && firstStage?.replayed === false) {
        result = await sendRemoval()
      }
      const { response, data } = result
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          paymentMethodIdempotencyKeys.current.delete(method.savedPaymentMethodId)
        }
        throw new Error(getApiErrorMessage(data, labels.paymentMethodError))
      }
      if (response.status === 200) {
        paymentMethodIdempotencyKeys.current.delete(method.savedPaymentMethodId)
        window.alert(labels.removalComplete)
      } else {
        window.alert(labels.removalAccepted)
      }
      await loadPaymentMethods()
    } catch (caught) {
      setPaymentMethodError(caught instanceof Error ? caught.message : labels.paymentMethodError)
    } finally {
      setRemovingPaymentMethodId(null)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
      void loadPaymentMethods()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <section className="flex flex-col" aria-busy={loading || loadingMore}>
      <header className="flex items-start justify-between gap-4 border-b border-light-border px-4 py-4 dark:border-dark-border">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{labels.eyebrow}</p>
          <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.description}</p>
        </div>
        <button
          className="shrink-0 rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
          disabled={loading || loadingMore}
          onClick={() => void load()}
          type="button"
        >
          {loading ? labels.refreshing : labels.refresh}
        </button>
      </header>

      {error ? <p className="border-b border-light-border px-4 py-3 text-sm text-rose-700 dark:border-dark-border dark:text-rose-300" role="alert">{error}</p> : null}
      <section className="border-b border-light-border bg-light-primary/5 px-4 py-4 dark:border-dark-border dark:bg-dark-primary/5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{labels.paymentMethodsTitle}</h2>
          <button
            type="button"
            disabled={paymentMethodsLoading || removingPaymentMethodId !== null}
            onClick={() => void loadPaymentMethods()}
            className="rounded-full border border-light-border px-3 py-1.5 text-xs font-bold disabled:opacity-50 dark:border-dark-border"
          >
            {labels.refresh}
          </button>
        </div>
        {paymentMethodsLoading ? (
          <p className="mt-3 text-sm text-light-secondary dark:text-dark-secondary">{labels.paymentMethodsLoading}</p>
        ) : paymentMethodError ? (
          <p className="mt-3 text-sm text-rose-700 dark:text-rose-300" role="alert">{paymentMethodError}</p>
        ) : paymentMethods.length === 0 ? (
          <p className="mt-3 text-sm text-light-secondary dark:text-dark-secondary">{labels.paymentMethodsEmpty}</p>
        ) : paymentMethods.map((method) => (
          <article key={method.savedPaymentMethodId} className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-light-border bg-white px-3 py-3 dark:border-dark-border dark:bg-dark-bg">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {method.brand || method.paymentMethod}
                {method.last4 ? ' •••• ' + method.last4 : ''}
              </p>
              <p className="mt-1 text-xs text-light-secondary dark:text-dark-secondary">
                {method.status === 'REVOCATION_PENDING'
                  ? labels.revocationPending
                  : method.status === 'ACTIVE'
                    ? labels.activeMandate
                    : method.status === 'SETUP_PENDING'
                    ? labels.setupPending
                    : labels.noRecurring}
                {method.expiryMonth && method.expiryYear ? ' · ' + method.expiryMonth + '/' + method.expiryYear : ''}
              </p>
            </div>
            <button
              type="button"
              disabled={removingPaymentMethodId !== null}
              onClick={() => void removePaymentMethod(method)}
              className="shrink-0 rounded-full border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300"
            >
              {removingPaymentMethodId === method.savedPaymentMethodId
                ? labels.refreshing
                : method.status === 'REVOCATION_PENDING' ? labels.retryRemoval : labels.removePaymentMethod}
            </button>
          </article>
        ))}
      </section>

      {loading && items.length === 0 ? (
        <section className="px-4 py-6 text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.loading}</section>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <section className="flex flex-col items-start gap-3 px-6 py-14">
          <strong className="text-xl font-bold">{labels.emptyTitle}</strong>
          <span className="text-sm text-light-secondary dark:text-dark-secondary">{labels.emptyBody}</span>
          <Link className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white hover:brightness-90" href="/content">{labels.discover}</Link>
        </section>
      ) : null}

      {items.map((item) => {
        return (
          <article className="border-b border-light-border px-4 py-4 dark:border-dark-border" key={item.subscriptionId}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-light-secondary dark:text-dark-secondary">{labels.plan}: {item.planId}</p>
                <h2 className="mt-1 text-base font-bold">{item.creatorId ? labels.creator : labels.membership}</h2>
                {item.creatorId ? (
                  <Link className="mt-2 inline-block text-sm font-medium text-main-accent hover:underline" href={'/users/' + encodeURIComponent(item.creatorId)}>
                    {labels.viewCreator}
                  </Link>
                ) : null}
              </div>
              <span className={'shrink-0 rounded-full px-3 py-1 text-xs font-bold ' + statusClass(item.status)}>
                {labels.status[item.status]}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-light-border pt-4 dark:border-dark-border sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.id}</dt>
                <dd className="mt-1 break-all text-sm font-medium">{item.subscriptionId}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.period}</dt>
                <dd className="mt-1 text-sm font-medium">{formatDate(item.currentPeriodStart, locale)} — {formatDate(item.currentPeriodEnd, locale)}</dd>
              </div>
              {item.cancelAt ? (
                <div className="min-w-0">
                  <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.cancelAt}</dt>
                  <dd className="mt-1 text-sm font-medium">{formatDate(item.cancelAt, locale)}</dd>
                </div>
              ) : null}
            </dl>

            {['ACTIVE', 'PAST_DUE', 'PAUSED'].includes(item.status) ? (
              <p className="mt-4 rounded-xl border border-light-border px-4 py-3 text-xs leading-5 text-light-secondary dark:border-dark-border dark:text-dark-secondary">
                {labels.mutationsUnavailable}
              </p>
            ) : null}
          </article>
        )
      })}

      {hasNextPage ? (
        <div className="flex justify-center px-4 py-5">
          <button
            className="rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
            disabled={loadingMore}
            onClick={() => void load(pageNumber + 1, true)}
            type="button"
          >
            {loadingMore ? labels.loadingMore : labels.loadMore}
          </button>
        </div>
      ) : null}

      <p className="px-4 py-4 text-xs leading-5 text-light-secondary dark:text-dark-secondary">
        {locale === 'en'
          ? 'This page reflects Subscription facts only; it does not treat subscription status as Entitlement or proof of payment.'
          : locale === 'tw'
            ? '此頁面僅呈現訂閱事實，不會把訂閱狀態直接視為內容權益或付款完成。'
            : '当前页面只反映 Subscription 事实，不把订阅状态直接当作 Entitlement 或支付完成。'}
      </p>
    </section>
  )
}
