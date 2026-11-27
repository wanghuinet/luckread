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

type LifecycleResponse = {
  data?: {
    subscriptionId?: string
    status?: Subscription['status']
    currentPeriodStart?: string
    currentPeriodEnd?: string
    cancelAt?: string | null
    version?: number
    etag?: string
    pending?: boolean
    reason?: 'RENEWAL_IN_FLIGHT'
  }
  error?: { code?: string; message?: string }
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
      description: 'Manage your creator subscriptions. Canceling stops future renewal while keeping the current paid period; pausing freezes paid access and stops renewal until you resume.',
      pause: 'Pause subscription',
      resume: 'Resume subscription',
      cancel: 'Cancel renewal',
      saving: 'Updating…',
      confirmPause: 'Pause this subscription now? Paid access will be frozen until you resume.',
      confirmResume: 'Resume this subscription? The remaining paid time will continue from today.',
      confirmCancel: 'Cancel future renewal? Your current paid access remains until the period ends.',
      confirmCancelPaused: 'Cancel this paused subscription permanently? It cannot be resumed.',
      updateSuccess: 'Subscription updated.',
      pendingRenewal: 'A renewal is still processing. This change is pending; refresh shortly to see the final status.',
      stale: 'This subscription changed elsewhere. Refresh and try again.',
      pauseUnavailable: 'Only active subscriptions without a pending cancellation can be paused.',
      resumeUnavailable: 'This subscription cannot be resumed.',
      mutationsUnavailable: 'No lifecycle action is available for this subscription right now.',
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
        description: '管理你的創作者訂閱。取消會停止未來續費，但保留目前已付款週期；暫停會凍結付費權益，直到你恢復訂閱。',
        pause: '暫停訂閱',
        resume: '恢復訂閱',
        cancel: '取消續費',
        saving: '正在更新…',
        confirmPause: '現在暫停此訂閱？暫停期間付費權益會凍結，直到你恢復。',
        confirmResume: '恢復此訂閱？剩餘的已付款時間會從今天起繼續計算。',
        confirmCancel: '取消未來續費？目前已付款的權益仍保留至週期結束。',
        confirmCancelPaused: '永久取消這個已暫停的訂閱？取消後不能恢復。',
        updateSuccess: '訂閱已更新。',
        pendingRenewal: '續費仍在處理中，此變更暫待完成；請稍後重新整理查看最終狀態。',
        stale: '訂閱已在其他位置變更，請重新整理後再試。',
        pauseUnavailable: '只有未安排取消的有效訂閱可以暫停。',
        resumeUnavailable: '此訂閱目前無法恢復。',
        mutationsUnavailable: '此訂閱目前沒有可用的生命週期操作。',
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
        description: '管理你的创作者订阅。取消会停止未来续费，但保留当前已付款周期；暂停会冻结付费权益，直到你恢复订阅。',
        pause: '暂停订阅',
        resume: '恢复订阅',
        cancel: '取消续费',
        saving: '正在更新…',
        confirmPause: '现在暂停此订阅？暂停期间付费权益会冻结，直到你恢复。',
        confirmResume: '恢复此订阅？剩余的已付款时间会从今天起继续计算。',
        confirmCancel: '取消未来续费？当前已付款的权益仍保留至周期结束。',
        confirmCancelPaused: '永久取消这个已暂停的订阅？取消后不能恢复。',
        updateSuccess: '订阅已更新。',
        pendingRenewal: '续费仍在处理中，此变更暂待完成；请稍后刷新查看最终状态。',
        stale: '订阅已在其他位置变更，请刷新后重试。',
        pauseUnavailable: '只有未安排取消的有效订阅可以暂停。',
        resumeUnavailable: '此订阅目前无法恢复。',
        mutationsUnavailable: '此订阅目前没有可用的生命周期操作。',
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
  const [busySubscriptionId, setBusySubscriptionId] = useState<string | null>(null)
  const [actionMessages, setActionMessages] = useState<Record<string, string>>({})
  const idempotencyKeys = useRef(new Map<string, string>())

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

  async function transition(item: Subscription, action: 'cancel' | 'pause' | 'resume') {
    const confirmText = action === 'pause'
      ? labels.confirmPause
      : action === 'resume'
        ? labels.confirmResume
        : item.status === 'PAUSED' ? labels.confirmCancelPaused : labels.confirmCancel
    if (!window.confirm(confirmText)) return
    const keyId = item.subscriptionId + ':' + action
    const idempotencyKey = idempotencyKeys.current.get(keyId) ?? crypto.randomUUID()
    idempotencyKeys.current.set(keyId, idempotencyKey)
    setBusySubscriptionId(item.subscriptionId)
    setError('')
    setActionMessages((current) => ({ ...current, [item.subscriptionId]: '' }))
    try {
      const { response, data } = await fetchJson<LifecycleResponse>(
        '/api/v1/memberships/subscriptions/' + encodeURIComponent(item.subscriptionId) + '/' + action,
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'If-Match': item.etag,
          },
          body: '{}',
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (response.status === 412) throw new Error(labels.stale)
      const next = data?.data
      if (next?.pending === true && next.reason === 'RENEWAL_IN_FLIGHT') {
        if (response.status === 202 && next.subscriptionId === item.subscriptionId &&
            typeof next.version === 'number' && next.etag === '"lr-v' + String(next.version) + '"' &&
            typeof next.currentPeriodStart === 'string' && typeof next.currentPeriodEnd === 'string' &&
            (next.cancelAt === null || typeof next.cancelAt === 'string')) {
          setItems((current) => current.map((entry) => entry.subscriptionId === item.subscriptionId
            ? { ...entry, status: next.status ?? entry.status, currentPeriodStart: next.currentPeriodStart!,
                currentPeriodEnd: next.currentPeriodEnd!, cancelAt: next.cancelAt, etag: next.etag! }
            : entry))
        }
        setActionMessages((current) => ({ ...current, [item.subscriptionId]: labels.pendingRenewal }))
        return
      }
      if (!response.ok || !next || next.subscriptionId !== item.subscriptionId ||
          !['ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED'].includes(String(next.status)) ||
          typeof next.currentPeriodStart !== 'string' || typeof next.currentPeriodEnd !== 'string' ||
          typeof next.version !== 'number' || !Number.isSafeInteger(next.version) ||
          next.etag !== '"lr-v' + String(next.version) + '"' ||
          !(next.cancelAt === null || typeof next.cancelAt === 'string')) {
        throw new Error(getApiErrorMessage(data, labels.updateError))
      }
      setItems((current) => current.map((entry) => entry.subscriptionId === item.subscriptionId
        ? { ...entry, status: next.status!, currentPeriodStart: next.currentPeriodStart!,
            currentPeriodEnd: next.currentPeriodEnd!, cancelAt: next.cancelAt, etag: next.etag! }
        : entry))
      idempotencyKeys.current.delete(keyId)
      setActionMessages((current) => ({ ...current, [item.subscriptionId]: labels.updateSuccess }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.updateError)
    } finally {
      setBusySubscriptionId(null)
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

            {actionMessages[item.subscriptionId] ? (
              <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                {actionMessages[item.subscriptionId]}
              </p>
            ) : null}
            {busySubscriptionId === item.subscriptionId ? (
              <p className="mt-3 text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.saving}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {item.status === 'ACTIVE' && item.cancelAt === null ? (
                <>
                  <button type="button" disabled={busySubscriptionId !== null}
                    onClick={() => void transition(item, 'pause')}
                    className="rounded-full border border-light-border px-4 py-2 text-sm font-semibold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10">
                    {labels.pause}
                  </button>
                  <button type="button" disabled={busySubscriptionId !== null}
                    onClick={() => void transition(item, 'cancel')}
                    className="rounded-full border border-light-border px-4 py-2 text-sm font-semibold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10">
                    {labels.cancel}
                  </button>
                </>
              ) : null}
              {item.status === 'PAST_DUE' && item.cancelAt === null ? (
                <button type="button" disabled={busySubscriptionId !== null}
                  onClick={() => void transition(item, 'cancel')}
                  className="rounded-full border border-light-border px-4 py-2 text-sm font-semibold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10">
                  {labels.cancel}
                </button>
              ) : null}
              {item.status === 'PAUSED' ? (
                <>
                  <button type="button" disabled={busySubscriptionId !== null}
                    onClick={() => void transition(item, 'resume')}
                    className="rounded-full border border-light-border px-4 py-2 text-sm font-semibold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10">
                    {labels.resume}
                  </button>
                  <button type="button" disabled={busySubscriptionId !== null}
                    onClick={() => void transition(item, 'cancel')}
                    className="rounded-full border border-light-border px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-dark-border dark:text-rose-300 dark:hover:bg-rose-950/30">
                    {labels.cancel}
                  </button>
                </>
              ) : null}
              {item.cancelAt ? (
                <p className="self-center text-xs text-light-secondary dark:text-dark-secondary">
                  {locale === 'en' ? 'Renewal is canceled; paid access remains until the period ends.' :
                    locale === 'tw' ? '已取消續費；已付款權益保留至週期結束。' :
                      '已取消续费；已付款权益保留至周期结束。'}
                </p>
              ) : null}
              {!['ACTIVE', 'PAST_DUE', 'PAUSED'].includes(item.status) || (item.status === 'ACTIVE' && item.cancelAt !== null) ? (
                <span className="self-center text-xs text-light-secondary dark:text-dark-secondary">{labels.mutationsUnavailable}</span>
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
