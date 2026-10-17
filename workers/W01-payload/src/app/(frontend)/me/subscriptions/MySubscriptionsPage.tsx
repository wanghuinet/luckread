'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

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

type MutationResponse = {
  data?: Subscription
  error?: { code?: string; message?: string }
}

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      eyebrow: 'LUCKREAD · MEMBERSHIP',
      description: 'Review subscription status and billing periods. Subscription records do not, by themselves, prove payment completion or access entitlement. Plan changes remain unavailable until the official plan catalog is connected.',
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
      pause: 'Pause subscription',
      resume: 'Resume subscription',
      cancel: 'Cancel subscription',
      processing: 'Working…',
      loadMore: 'Load more subscriptions',
      loadingMore: 'Loading more…',
      cancelConfirm: 'Cancel this subscription?',
      cancelSuccess: 'Subscription canceled.',
      pauseSuccess: 'Subscription paused.',
      resumeSuccess: 'Subscription resumed.',
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
        description: '查看訂閱狀態與週期。訂閱記錄本身不代表付款完成或已取得內容權益；方案變更將在正式方案目錄接入後開放。',
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
        pause: '暫停訂閱',
        resume: '恢復訂閱',
        cancel: '取消訂閱',
        processing: '處理中…',
        loadMore: '載入更多訂閱',
        loadingMore: '載入中…',
        cancelConfirm: '確定取消這個訂閱嗎？',
        cancelSuccess: '訂閱已取消。',
        pauseSuccess: '訂閱已暫停。',
        resumeSuccess: '訂閱已恢復。',
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
        description: '查看订阅状态与周期。权益和支付状态仍由各自权威域负责；方案变更将在正式方案目录接入后开放。',
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
        pause: '暂停订阅',
        resume: '恢复订阅',
        cancel: '取消订阅',
        processing: '处理中…',
        loadMore: '加载更多订阅',
        loadingMore: '加载中…',
        cancelConfirm: '确定取消这个订阅吗？',
        cancelSuccess: '订阅已取消。',
        pauseSuccess: '订阅已暂停。',
        resumeSuccess: '订阅已恢复。',
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
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

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

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function transition(item: Subscription, operation: 'cancel' | 'pause' | 'resume') {
    if (operation === 'cancel' && !window.confirm(labels.cancelConfirm)) return
    setBusyId(item.subscriptionId)
    setError('')
    setMessage('')
    try {
      const { response, data } = await fetchJson<MutationResponse>(
        '/api/v1/memberships/subscriptions/' + encodeURIComponent(item.subscriptionId) + '/' + operation,
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'If-Match': item.etag,
            'Idempotency-Key': operation + ':' + item.subscriptionId + ':' + item.etag,
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data?.subscriptionId) {
        throw new Error(getApiErrorMessage(data, labels.updateError))
      }
      setItems((current) => current.map((currentItem) =>
        currentItem.subscriptionId === item.subscriptionId ? data.data! : currentItem,
      ))
      setMessage(operation === 'cancel' ? labels.cancelSuccess : operation === 'pause' ? labels.pauseSuccess : labels.resumeSuccess)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.updateError)
    } finally {
      setBusyId(null)
    }
  }

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

      {message ? <p className="border-b border-light-border px-4 py-3 text-sm text-emerald-700 dark:border-dark-border dark:text-emerald-300" role="status">{message}</p> : null}
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
        const busy = busyId === item.subscriptionId
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

            <div className="mt-4 flex flex-wrap gap-2">
              {['ACTIVE', 'PAST_DUE'].includes(item.status) ? (
                <button className="rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10" disabled={busy} onClick={() => void transition(item, 'pause')} type="button">{busy ? labels.processing : labels.pause}</button>
              ) : null}
              {item.status === 'PAUSED' ? (
                <button className="rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10" disabled={busy} onClick={() => void transition(item, 'resume')} type="button">{busy ? labels.processing : labels.resume}</button>
              ) : null}
              {['ACTIVE', 'PAST_DUE', 'PAUSED'].includes(item.status) ? (
                <button className="rounded-full border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950" disabled={busy} onClick={() => void transition(item, 'cancel')} type="button">{busy ? labels.processing : labels.cancel}</button>
              ) : null}
            </div>
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
