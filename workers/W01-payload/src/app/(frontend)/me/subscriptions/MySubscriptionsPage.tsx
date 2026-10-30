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

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      eyebrow: 'LUCKREAD · MEMBERSHIP',
      description: 'Review your subscription status and billing period. Pausing or canceling stops member access immediately; completed payments are not automatically refunded.',
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
      mutationsNotice: 'Pausing or canceling stops member access immediately. Canceling a past-due subscription also stops further renewal retries. Completed payments are not automatically refunded; resume is available only before the paid-through period ends.',
pauseAction: 'Pause subscription',
resumeAction: 'Resume subscription',
cancelAction: 'Cancel now',

      loadMore: 'Load more subscriptions',
      loadingMore: 'Loading more…',
      loadError: 'Could not load subscriptions.',
      updateError: 'Could not update subscription.',
      sessionExpired: 'Your session has expired. Sign in again.',
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
        description: '查看訂閱狀態與週期。暫停或取消會立即停止會員內容存取；已完成的付款不會自動退款。',
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
        mutationsNotice: '暫停或取消會立即停止會員內容存取；逾期訂閱取消後也會停止後續續費重試。已完成付款不會自動退款。只有在已付款週期結束前才能恢復。',
pauseAction: '暫停訂閱',
resumeAction: '恢復訂閱',
cancelAction: '立即取消',

        loadMore: '載入更多訂閱',
        loadingMore: '載入中…',
        loadError: '無法讀取訂閱。',
        updateError: '無法更新訂閱狀態。',
        sessionExpired: '登入已失效，請重新登入。',
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
        description: '查看订阅状态与周期。暂停或取消会立即停止会员内容访问；已完成的付款不会自动退款。',
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
        mutationsNotice: '暂停或取消会立即停止会员内容访问；逾期订阅取消后也会停止后续续费重试。已完成付款不会自动退款。只有当前已付款周期尚未结束时才能恢复。',
pauseAction: '暂停订阅',
resumeAction: '恢复订阅',
cancelAction: '立即取消',

        loadMore: '加载更多订阅',
        loadingMore: '加载中…',
        loadError: '订阅读取失败。',
        updateError: '订阅状态更新失败。',
        sessionExpired: '登录已失效，请重新登录。',
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
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const mutationKeysRef = useRef(new Map<string, string>())

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

  async function mutate(item: Subscription, operation: 'cancel' | 'pause' | 'resume') {
    const message = operation === 'cancel'
      ? (locale === 'en'
        ? 'Cancel now? Member access and future renewal retries will stop. Completed payments are not automatically refunded.'
        : locale === 'tw'
          ? '確定立即取消？會員內容存取及後續續費重試會停止，已完成的付款不會自動退款。'
          : '确定立即取消？会员内容访问及后续续费重试会停止，已完成的付款不会自动退款。')
      : operation === 'pause'
        ? (locale === 'en'
          ? 'Pause now? Member access will stop immediately.'
          : locale === 'tw'
            ? '確定立即暫停？會員內容存取會立即停止。'
            : '确定立即暂停？会员内容访问会立即停止。')
        : (locale === 'en'
          ? 'Resume this subscription? The paid-through period must not have ended.'
          : locale === 'tw'
            ? '確定恢復訂閱？目前已付款週期必須尚未結束。'
            : '确定恢复订阅？当前已付款周期必须尚未结束。')
    if (!window.confirm(message)) return
    const mutationSignature = item.subscriptionId + ':' + operation + ':' + item.etag
    let idempotencyKey = mutationKeysRef.current.get(mutationSignature)
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID().replaceAll('-', '')
      mutationKeysRef.current.set(mutationSignature, idempotencyKey)
    }
    setMutatingId(item.subscriptionId)
    setError('')
    try {
      const { response, data } = await fetchJson<unknown>(
        '/api/v1/memberships/subscriptions/' + encodeURIComponent(item.subscriptionId) + '/' + operation,
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'If-Match': item.etag,
            'Idempotency-Key': idempotencyKey,
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          mutationKeysRef.current.delete(mutationSignature)
        }
        throw new Error(getApiErrorMessage(data, labels.updateError))
      }
      mutationKeysRef.current.delete(mutationSignature)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.updateError)
    } finally {
      setMutatingId(null)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
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

            {(item.status === 'ACTIVE' || item.status === 'PAUSED' || item.status === 'PAST_DUE') ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {item.status === 'ACTIVE' ? (
                  <button
                    type="button"
                    disabled={mutatingId !== null || loading}
                    onClick={() => void mutate(item, 'pause')}
                    className="rounded-full border border-amber-300 px-4 py-2 text-sm font-bold text-amber-700 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300"
                  >
                    {labels.pauseAction}
                  </button>
                ) : item.status === 'PAUSED' ? (
                  <button
                    type="button"
                    disabled={mutatingId !== null || loading}
                    onClick={() => void mutate(item, 'resume')}
                    className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {labels.resumeAction}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={mutatingId !== null || loading}
                  onClick={() => void mutate(item, 'cancel')}
                  className="rounded-full border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300"
                >
                  {labels.cancelAction}
                </button>
                {mutatingId === item.subscriptionId ? <span className="self-center text-xs text-light-secondary">Updating…</span> : null}
              </div>
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

      {items.some((item) => item.status === 'ACTIVE' || item.status === 'PAUSED' || item.status === 'PAST_DUE') ? (
        <p className="px-4 py-4 text-xs leading-5 text-light-secondary dark:text-dark-secondary">{labels.mutationsNotice}</p>
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
