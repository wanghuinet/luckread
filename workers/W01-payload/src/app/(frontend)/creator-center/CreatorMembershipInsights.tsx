'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'

type StudioLocale = 'zh-CN' | 'en-US'
type MembershipSummary = {
  plans: { total: number; draft: number; active: number; paused: number; retired: number }
  subscriptions: {
    total: number
    pending: number
    active: number
    pastDue: number
    paused: number
    canceled: number
    expired: number
    activeSubscribers: number
  }
}
type SummaryEnvelope = { data?: MembershipSummary; error?: { code?: string; message?: string } }
type ViewState = { summary: MembershipSummary | null; loading: boolean; error: string }

const copy = (locale: StudioLocale) => locale === 'en-US' ? {
  eyebrow: 'MEMBERSHIP INSIGHTS',
  title: 'Membership overview',
  intro: 'Live aggregate counts from W07 membership records. This view never exposes member identities.',
  loading: 'Loading membership summary…',
  reload: 'Refresh',
  plans: 'Membership plans',
  subscriptions: 'Subscription records',
  activeSubscribers: 'Active subscribers',
  planStates: 'Plan status',
  subscriptionStates: 'Subscription status',
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  retired: 'Retired',
  pending: 'Pending verification',
  pastDue: 'Past due',
  canceled: 'Canceled',
  expired: 'Expired',
  unavailable: 'Not available yet',
  earnings: 'Earnings',
  earningsNote: 'Paid checkout and verified fulfillment are not enabled. Earnings are intentionally unavailable and are never inferred from subscriptions or analytics events.',
  authority: 'Source: W07 authoritative membership records (D1-01). Counts are not payment or payout evidence.',
  loadError: 'Could not load membership summary.',
  retry: 'Retry',
} : {
  eyebrow: '会员数据',
  title: '会员概览',
  intro: '实时读取 W07 会员权威记录的汇总，只显示统计数量，不暴露会员身份。',
  loading: '正在加载会员汇总…',
  reload: '刷新',
  plans: '会员方案',
  subscriptions: '订阅记录',
  activeSubscribers: '活跃订阅者',
  planStates: '方案状态',
  subscriptionStates: '订阅状态',
  draft: '草稿',
  active: '活跃',
  paused: '已暂停',
  retired: '已退役',
  pending: '待验证',
  pastDue: '逾期',
  canceled: '已取消',
  expired: '已到期',
  unavailable: '暂不可用',
  earnings: '收益',
  earningsNote: '付费下单与已验证履约尚未开放。收益数据暂不可用，不会根据订阅记录或分析事件推算收入。',
  authority: '数据源：W07 会员权威记录（D1-01）。订阅数量不代表收款或可结算收益。',
  loadError: '无法读取会员汇总。',
  retry: '重试',
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSummary(value: unknown): value is MembershipSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const root = value as Record<string, unknown>
  if (!root.plans || typeof root.plans !== 'object' || Array.isArray(root.plans) ||
      !root.subscriptions || typeof root.subscriptions !== 'object' || Array.isArray(root.subscriptions)) return false
  const plans = root.plans as Record<string, unknown>
  const subscriptions = root.subscriptions as Record<string, unknown>
  const planKeys = ['total', 'draft', 'active', 'paused', 'retired']
  const subscriptionKeys = ['total', 'pending', 'active', 'pastDue', 'paused', 'canceled', 'expired', 'activeSubscribers']
  return planKeys.every((key) => isCount(plans[key])) &&
    subscriptionKeys.every((key) => isCount(subscriptions[key])) &&
    plans.total === Number(plans.draft) + Number(plans.active) + Number(plans.paused) + Number(plans.retired) &&
    subscriptions.total === Number(subscriptions.pending) + Number(subscriptions.active) +
      Number(subscriptions.pastDue) + Number(subscriptions.paused) +
      Number(subscriptions.canceled) + Number(subscriptions.expired)
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-light-border bg-light-primary/5 p-3 dark:border-dark-border dark:bg-dark-primary/10">
      <p className="text-xs text-light-secondary dark:text-dark-secondary">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString('zh-CN')}</p>
    </div>
  )
}

export default function CreatorMembershipInsights({ locale = 'zh-CN' }: { locale?: StudioLocale }) {
  const labels = copy(locale)
  const router = useRouter()
  const [state, setState] = useState<ViewState>({ summary: null, loading: true, error: '' })

  async function loadSummary() {
    try {
      const { response, data } = await fetchJson<SummaryEnvelope>('/api/v1/membership/creator-summary', {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + '#membership-insights'
        router.push('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !isSummary(data?.data)) {
        throw new Error(getApiErrorMessage(data, labels.loadError))
      }
      setState({ summary: data.data, loading: false, error: '' })
    } catch (error) {
      setState({
        summary: null,
        loading: false,
        error: error instanceof Error ? error.message : labels.loadError,
      })
    }
  }

  useEffect(() => {
    let active = true
    const run = async () => {
      try {
        const { response, data } = await fetchJson<SummaryEnvelope>('/api/v1/membership/creator-summary', {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (!active) return
        if (response.status === 401) {
          const returnTo = window.location.pathname + window.location.search + '#membership-insights'
          router.push('/login?returnTo=' + encodeURIComponent(returnTo))
          return
        }
        if (!response.ok || !isSummary(data?.data)) throw new Error(getApiErrorMessage(data, labels.loadError))
        setState({ summary: data.data, loading: false, error: '' })
      } catch (error) {
        if (active) setState({ summary: null, loading: false, error: error instanceof Error ? error.message : labels.loadError })
      }
    }
    void run()
    return () => { active = false }
  }, [labels.loadError, router])

  const summary = state.summary
  return (
    <section id="membership-insights" className="my-8 rounded-2xl border border-light-border bg-white dark:border-dark-border dark:bg-dark-primary/20" aria-busy={state.loading}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-light-border px-5 py-5 dark:border-dark-border">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{labels.eyebrow}</p>
          <h2 className="mt-2 text-xl font-bold">{labels.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.intro}</p>
        </div>
        <button type="button" disabled={state.loading} onClick={() => { setState((current) => ({ ...current, loading: true, error: '' })); void loadSummary() }}
          className="shrink-0 rounded-full border border-light-border px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border">
          {labels.reload}
        </button>
      </header>

      {state.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" role="alert">
          <p className="text-sm text-rose-700 dark:text-rose-300">{state.error}</p>
          <button type="button" disabled={state.loading} onClick={() => { setState((current) => ({ ...current, loading: true, error: '' })); void loadSummary() }}
            className="rounded-full border border-light-border px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border">
            {labels.retry}
          </button>
        </div>
      ) : null}

      {state.loading && !summary ? <p role="status" className="px-5 py-8 text-sm text-light-secondary dark:text-dark-secondary">{labels.loading}</p> : null}

      {summary ? (
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <CountTile label={labels.plans} value={summary.plans.total} />
            <CountTile label={labels.subscriptions} value={summary.subscriptions.total} />
            <CountTile label={labels.activeSubscribers} value={summary.subscriptions.activeSubscribers} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-bold">{labels.planStates}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <CountTile label={labels.draft} value={summary.plans.draft} />
                <CountTile label={labels.active} value={summary.plans.active} />
                <CountTile label={labels.paused} value={summary.plans.paused} />
                <CountTile label={labels.retired} value={summary.plans.retired} />
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-bold">{labels.subscriptionStates}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <CountTile label={labels.pending} value={summary.subscriptions.pending} />
                <CountTile label={labels.active} value={summary.subscriptions.active} />
                <CountTile label={labels.pastDue} value={summary.subscriptions.pastDue} />
                <CountTile label={labels.paused} value={summary.subscriptions.paused} />
                <CountTile label={labels.canceled} value={summary.subscriptions.canceled} />
                <CountTile label={labels.expired} value={summary.subscriptions.expired} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-light-border px-4 py-4 dark:border-dark-border">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold">{labels.earnings}</h3>
              <span className="rounded-full border border-light-border px-3 py-1 text-xs font-bold dark:border-dark-border">{labels.unavailable}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.earningsNote}</p>
          </div>
          <p className="text-xs leading-5 text-light-secondary dark:text-dark-secondary">{labels.authority}</p>
        </div>
      ) : null}
    </section>
  )
}
