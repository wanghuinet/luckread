'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'

type StudioLocale = 'zh-CN' | 'en-US'
type PlanStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED'
type MembershipPlan = {
  planId: string
  creatorId: string
  planVersion: number
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
  trialDays: number
  benefits: string[]
  status: PlanStatus
  visibility: 'PRIVATE' | 'PUBLIC'
  version: number
  createdAt: string
  updatedAt: string
  etag: string
  replayed: boolean
}
type PlanEnvelope = { data?: MembershipPlan; error?: { code?: string; message?: string } }
type PlanListEnvelope = {
  data?: { docs?: MembershipPlan[]; nextCursor?: string | null; hasMore?: boolean }
  error?: { code?: string; message?: string }
}

const isPlan = (value: unknown): value is MembershipPlan => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return typeof plan.planId === 'string' && /^plan_[a-f0-9]{64}$/.test(plan.planId) &&
    typeof plan.creatorId === 'string' && Number.isSafeInteger(plan.planVersion) && Number(plan.planVersion) >= 1 &&
    typeof plan.name === 'string' && typeof plan.tier === 'string' &&
    (plan.billingInterval === 'MONTHLY' || plan.billingInterval === 'YEARLY') &&
    Number.isSafeInteger(plan.priceMinor) && Number(plan.priceMinor) >= 0 && Number(plan.priceMinor) <= 2_147_483_647 &&
    typeof plan.currency === 'string' && /^[A-Z]{3}$/.test(plan.currency) &&
    Number.isSafeInteger(plan.trialDays) && Number(plan.trialDays) >= 0 && Number(plan.trialDays) <= 90 &&
    Array.isArray(plan.benefits) && plan.benefits.length <= 20 &&
    plan.benefits.every((benefit) => typeof benefit === 'string' && benefit.length > 0 && benefit.length <= 180) &&
    ['DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED'].includes(String(plan.status)) &&
    (plan.visibility === 'PRIVATE' || plan.visibility === 'PUBLIC') &&
    Number.isSafeInteger(plan.version) && Number(plan.version) >= 1 &&
    typeof plan.etag === 'string' && plan.etag === '"lr-plan-v' + String(plan.version) + '"' &&
    typeof plan.createdAt === 'string' && !Number.isNaN(Date.parse(plan.createdAt)) &&
    typeof plan.updatedAt === 'string' && !Number.isNaN(Date.parse(plan.updatedAt)) &&
    typeof plan.replayed === 'boolean'
}

function formatPrice(priceMinor: number, currency: string, locale: StudioLocale): string {
  try {
    return new Intl.NumberFormat(locale === 'en-US' ? 'en-US' : 'zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(priceMinor / 100)
  } catch {
    return String(priceMinor) + ' ' + currency
  }
}

const copy = (locale: StudioLocale) => locale === 'en-US' ? {
  eyebrow: 'MEMBERSHIP COMMERCE',
  title: 'Membership plans',
  intro: 'Create and manage immutable membership offers. Publishing a plan makes it discoverable, but paid checkout stays unavailable until authoritative pricing and tax decisions are connected.',
  reload: 'Refresh',
  loading: 'Loading plans…',
  empty: 'No membership plans yet. Create a draft to get started.',
  create: 'Create draft',
  creating: 'Creating…',
  editTerms: 'Edit terms',
  cancelEdit: 'Cancel',
  saveTerms: 'Save new version',
  savingTerms: 'Saving…',
  revisionHeading: 'Create an immutable plan version',
  successRevision: 'Plan version saved. Existing subscriptions keep their previous version.',
  revisionValidation: 'Enter a valid name, lowercase tier key, and price with up to two decimal places.',
  revisionBenefitsError: 'Add no more than 20 unique benefits, each at most 180 characters.',
  name: 'Plan name',
  namePlaceholder: 'Supporter membership',
  tier: 'Tier key',
  tierPlaceholder: 'supporter',
  price: 'Price (USD)',
  interval: 'Billing interval',
  monthly: 'Monthly',
  yearly: 'Yearly',
  benefits: 'Benefits (one per line)',
  trialDays: 'Free trial (days, 0 disables)',
  trialDaysLabel: 'Trial',
  benefitsPlaceholder: 'Member-only posts\nCommunity updates',
  submit: 'Create plan draft',
  validation: 'Enter a valid name, lowercase tier key, and price with up to two decimal places.',
  benefitsError: 'Add no more than 20 unique benefits, each at most 180 characters.',
  publish: 'Publish',
  pause: 'Pause sales',
  resume: 'Resume sales',
  retire: 'Retire permanently',
  confirmRetire: 'Retire this paused plan permanently? It cannot be reactivated.',
  status: { DRAFT: 'Draft', ACTIVE: 'Active / public', PAUSED: 'Paused / private', RETIRED: 'Retired' },
  successCreate: 'Draft created.',
  success: { publish: 'Plan published.', pause: 'New sales paused.', resume: 'New sales resumed.', retire: 'Plan permanently retired.' },
  loadError: 'Could not load membership plans.',
  actionError: 'Could not change this plan.',
  auth: 'Your session expired. Sign in again.',
  stale: 'This plan changed elsewhere. Refresh and try again.',
  noPaidCheckout: 'Paid checkout is not enabled yet; publishing does not activate payment or member entitlements.',
  id: 'Plan ID',
  priceLabel: 'Price',
  periodLabel: 'Interval',
  version: 'Plan version',
  benefitsLabel: 'Benefits',
  noBenefits: 'No benefits defined',
  actionBusy: 'Saving…',
} : {
  eyebrow: '会员与商业化',
  title: '会员方案管理',
  intro: '创建并管理会员方案。发布方案只会使其进入公开目录；在权威定价与税务决策接入前，付费下单仍保持关闭。',
  reload: '刷新',
  loading: '正在加载会员方案…',
  empty: '还没有会员方案，先创建一个草稿。',
  create: '新建草稿',
  creating: '正在创建…',
  editTerms: '编辑方案',
  cancelEdit: '取消',
  saveTerms: '保存新版本',
  savingTerms: '正在保存…',
  revisionHeading: '创建不可变方案版本',
  successRevision: '方案新版本已保存，现有订阅仍保留原方案版本。',
  revisionValidation: '请输入有效的名称、小写等级标识，以及最多两位小数的价格。',
  revisionBenefitsError: '权益最多 20 项，不得重复，每项最多 180 个字符。',
  name: '方案名称',
  namePlaceholder: '支持者会员',
  tier: '等级标识',
  tierPlaceholder: 'supporter',
  price: '价格（USD）',
  interval: '计费周期',
  monthly: '每月',
  yearly: '每年',
  benefits: '会员权益（每行一项）',
  trialDays: '免费试用天数（0 表示关闭）',
  trialDaysLabel: '试用',
  benefitsPlaceholder: '会员专属文章\n社区动态',
  submit: '创建方案草稿',
  validation: '请输入有效的名称、小写等级标识，以及最多两位小数的价格。',
  benefitsError: '权益最多 20 项，不得重复，每项最多 180 个字符。',
  publish: '发布方案',
  pause: '暂停新销售',
  resume: '恢复新销售',
  retire: '永久退役',
  confirmRetire: '确定永久退役此已暂停方案吗？退役后不能重新激活。',
  status: { DRAFT: '草稿', ACTIVE: '已发布 / 公开', PAUSED: '已暂停 / 私有', RETIRED: '已退役' },
  successCreate: '方案草稿已创建。',
  success: { publish: '方案已发布。', pause: '已暂停新销售。', resume: '已恢复新销售。', retire: '方案已永久退役。' },
  loadError: '无法读取会员方案。',
  actionError: '无法更新此方案。',
  auth: '登录状态已失效，请重新登录。',
  stale: '方案已在其他位置变更，请刷新后重试。',
  noPaidCheckout: '付费下单暂未开放；发布方案不会自动触发收款或开通会员权益。',
  id: '方案 ID',
  priceLabel: '价格',
  periodLabel: '周期',
  version: '方案版本',
  benefitsLabel: '权益',
  noBenefits: '未定义权益',
  actionBusy: '保存中…',
}

export default function CreatorMembershipPlans({ locale = 'zh-CN' }: { locale?: StudioLocale }) {
  const labels = copy(locale)
  const router = useRouter()
  const redirectToLogin = useCallback(() => {
    const returnTo = window.location.pathname + window.location.search + '#membership-plans'
    router.push('/login?returnTo=' + encodeURIComponent(returnTo))
  }, [router])
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [planName, setPlanName] = useState('')
  const [tier, setTier] = useState('supporter')
  const [price, setPrice] = useState('5.00')
  const [trialDays, setTrialDays] = useState(0)
  const [interval, setInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY')
  const [benefitsText, setBenefitsText] = useState('')
  const [createKey, setCreateKey] = useState('')
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTier, setEditTier] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editTrialDays, setEditTrialDays] = useState(0)
  const [editInterval, setEditInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY')
  const [editBenefitsText, setEditBenefitsText] = useState('')
  const [editKey, setEditKey] = useState('')
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null)

  const loadPlans = useCallback(async (append = false, cursorValue: string | null = null) => {
    try {
      const query = new URLSearchParams({ limit: '20' })
      if (cursorValue) query.set('cursor', cursorValue)
      const { response, data } = await fetchJson<PlanListEnvelope>(
        '/api/v1/membership/plans?' + query.toString(),
        { credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } },
      )
      if (response.status === 401) { redirectToLogin(); return }
      if (!response.ok || !Array.isArray(data?.data?.docs) || !data.data.docs.every(isPlan)) {
        throw new Error(getApiErrorMessage(data, labels.loadError))
      }
      setError('')
      setPlans((current) => append ? [...current, ...data.data!.docs!] : data.data!.docs!)
      setNextCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
      setHasMore(data.data.hasMore === true && typeof data.data.nextCursor === 'string')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [labels.loadError, redirectToLogin])

  useEffect(() => {
    let active = true
    const loadInitialPlans = async () => {
      try {
        const { response, data } = await fetchJson<PlanListEnvelope>(
          '/api/v1/membership/plans?limit=20',
          { credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } },
        )
        if (!active) return
        if (response.status === 401) { redirectToLogin(); return }
        if (!response.ok || !Array.isArray(data?.data?.docs) || !data.data.docs.every(isPlan)) {
          throw new Error(getApiErrorMessage(data, labels.loadError))
        }
        setError('')
        setPlans(data.data.docs)
        setNextCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
        setHasMore(data.data.hasMore === true && typeof data.data.nextCursor === 'string')
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : labels.loadError)
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadInitialPlans()
    return () => { active = false }
  }, [labels.loadError, redirectToLogin])

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    const normalizedTier = tier.trim()
    const rawBenefits = benefitsText.split('\n').map((value) => value.trim()).filter(Boolean)
    if (!planName.trim() || planName.trim().length > 120 ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(normalizedTier) ||
        !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(price.trim())) {
      setError(labels.validation)
      return
    }
    if (rawBenefits.length > 20 || rawBenefits.some((value) => value.length > 180) ||
        new Set(rawBenefits).size !== rawBenefits.length) {
      setError(labels.benefitsError)
      return
    }
    const [whole, fraction = ''] = price.trim().split('.')
    const priceMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
    if (!Number.isSafeInteger(priceMinor) || priceMinor < 0 || priceMinor > 2_147_483_647 ||
        !Number.isSafeInteger(trialDays) || trialDays < 0 || trialDays > 90) {
      setError(labels.validation)
      return
    }
    const key = createKey || crypto.randomUUID()
    setCreateKey(key)
    setCreating(true)
    try {
      const { response, data } = await fetchJson<PlanEnvelope>('/api/v1/membership/plans', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({
          name: planName.trim(), tier: normalizedTier, billingInterval: interval,
          priceMinor, currency: 'USD', benefits: rawBenefits, trialDays,
        }),
      })
      if (response.status === 401) { redirectToLogin(); return }
      if (!response.ok || !isPlan(data?.data) || data.data.status !== 'DRAFT') {
        throw new Error(getApiErrorMessage(data, labels.actionError))
      }
      setPlans((current) => [data.data!, ...current.filter((item) => item.planId !== data.data!.planId)])
      setMessage(labels.successCreate)
      setPlanName('')
      setTrialDays(0)
      setBenefitsText('')
      setCreateKey('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.actionError)
    } finally {
      setCreating(false)
    }
  }

  function beginRevision(plan: MembershipPlan) {
    setEditingPlanId(plan.planId)
    setEditName(plan.name)
    setEditTier(plan.tier)
    setEditPrice(String(Math.floor(plan.priceMinor / 100)) + '.' + String(plan.priceMinor % 100).padStart(2, '0'))
    setEditTrialDays(plan.trialDays)
    setEditInterval(plan.billingInterval)
    setEditBenefitsText(plan.benefits.join('\n'))
    setEditKey(crypto.randomUUID())
    setError('')
    setMessage('')
  }

  async function saveRevision(event: FormEvent<HTMLFormElement>, plan: MembershipPlan) {
    event.preventDefault()
    if (editingPlanId !== plan.planId) return
    setError('')
    setMessage('')
    const normalizedTier = editTier.trim()
    const rawBenefits = editBenefitsText.split('\n').map((value) => value.trim()).filter(Boolean)
    const normalizedPrice = editPrice.trim()
    if (!editName.trim() || editName.trim().length > 120 ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(normalizedTier) ||
        !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(normalizedPrice)) {
      setError(labels.revisionValidation)
      return
    }
    if (rawBenefits.length > 20 || rawBenefits.some((value) => value.length > 180) ||
        new Set(rawBenefits).size !== rawBenefits.length) {
      setError(labels.revisionBenefitsError)
      return
    }
    const [whole, fraction = ''] = normalizedPrice.split('.')
    const priceMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
    if (!Number.isSafeInteger(priceMinor) || priceMinor < 0 || priceMinor > 2_147_483_647 ||
        !Number.isSafeInteger(editTrialDays) || editTrialDays < 0 || editTrialDays > 90) {
      setError(labels.revisionValidation)
      return
    }
    const key = editKey || crypto.randomUUID()
    setEditKey(key)
    setSavingPlanId(plan.planId)
    try {
      const { response, data } = await fetchJson<PlanEnvelope>(
        '/api/v1/membership/plans/' + encodeURIComponent(plan.planId),
        {
          method: 'PUT',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'If-Match': plan.etag,
            'Idempotency-Key': key,
          },
          body: JSON.stringify({
            name: editName.trim(),
            tier: normalizedTier,
            billingInterval: editInterval,
            priceMinor,
            currency: plan.currency,
            benefits: rawBenefits,
            trialDays: editTrialDays,
          }),
        },
      )
      if (response.status === 401) { redirectToLogin(); return }
      if (response.status === 412) throw new Error(labels.stale)
      if (!response.ok || !isPlan(data?.data) ||
          data.data.planId !== plan.planId || data.data.creatorId !== plan.creatorId ||
          data.data.status !== plan.status ||
          ![plan.version, plan.version + 1].includes(data.data.version) ||
          ![plan.planVersion, plan.planVersion + 1].includes(data.data.planVersion)) {
        throw new Error(getApiErrorMessage(data, labels.actionError))
      }
      setPlans((current) => current.map((item) => item.planId === plan.planId ? data.data! : item))
      setMessage(labels.successRevision)
      setEditingPlanId(null)
      setEditKey('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.actionError)
    } finally {
      setSavingPlanId(null)
    }
  }

  async function transition(plan: MembershipPlan, action: 'publish' | 'pause' | 'resume' | 'retire') {
    if (action === 'retire' && !window.confirm(labels.confirmRetire)) return
    setBusyPlanId(plan.planId)
    setError('')
    setMessage('')
    try {
      const lifecycle = action !== 'publish'
      const path = '/api/v1/membership/plans/' + encodeURIComponent(plan.planId) +
        (lifecycle ? '/lifecycle' : '/publish')
      const { response, data } = await fetchJson<PlanEnvelope>(path, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...(lifecycle ? { 'content-type': 'application/json' } : {}),
          'If-Match': plan.etag,
        },
        ...(lifecycle ? { body: JSON.stringify({ action }) } : {}),
      })
      if (response.status === 401) { redirectToLogin(); return }
      if (response.status === 412) throw new Error(labels.stale)
      if (!response.ok || !isPlan(data?.data)) throw new Error(getApiErrorMessage(data, labels.actionError))
      setPlans((current) => current.map((item) => item.planId === plan.planId ? data.data! : item))
      setMessage(labels.success[action])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.actionError)
    } finally {
      setBusyPlanId(null)
    }
  }

  return (
    <section id="membership-plans" className="my-8 rounded-2xl border border-light-border bg-white dark:border-dark-border dark:bg-dark-primary/20" aria-busy={loading || creating || busyPlanId !== null}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-light-border px-5 py-5 dark:border-dark-border">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{labels.eyebrow}</p>
          <h2 className="mt-2 text-xl font-bold">{labels.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.intro}</p>
        </div>
        <button type="button" disabled={loading || loadingMore} onClick={() => { setLoading(true); setError(''); void loadPlans(false, null) }}
          className="shrink-0 rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10">
          {labels.reload}
        </button>
      </header>

      {message ? <p role="status" className="border-b border-light-border px-5 py-3 text-sm text-emerald-700 dark:border-dark-border dark:text-emerald-300">{message}</p> : null}
      {error ? <p role="alert" className="border-b border-light-border px-5 py-3 text-sm text-rose-700 dark:border-dark-border dark:text-rose-300">{error}</p> : null}

      <form onSubmit={(event) => void createPlan(event)} className="grid grid-cols-1 gap-4 border-b border-light-border p-5 dark:border-dark-border md:grid-cols-2 xl:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {labels.name}
          <input required maxLength={120} value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder={labels.namePlaceholder}
            className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {labels.tier}
          <input required maxLength={64} pattern="[a-z][a-z0-9_-]{0,63}" value={tier} onChange={(event) => setTier(event.target.value)} placeholder={labels.tierPlaceholder}
            className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {labels.price}
          <input required inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} pattern="(0|[1-9][0-9]*)(\.[0-9]{1,2})?" placeholder="5.00"
            className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {labels.trialDays}
          <input type="number" min={0} max={90} step={1} value={trialDays} onChange={(event) => setTrialDays(Number(event.target.value))}
            className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {labels.interval}
          <select value={interval} onChange={(event) => setInterval(event.target.value as 'MONTHLY' | 'YEARLY')}
            className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border">
            <option value="MONTHLY">{labels.monthly}</option>
            <option value="YEARLY">{labels.yearly}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold md:col-span-2">
          {labels.benefits}
          <textarea rows={3} value={benefitsText} onChange={(event) => setBenefitsText(event.target.value)} placeholder={labels.benefitsPlaceholder}
            className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={creating} className="rounded-full bg-main-accent px-5 py-2.5 text-sm font-bold text-white hover:brightness-90 disabled:opacity-50">
            {creating ? labels.creating : labels.submit}
          </button>
        </div>
      </form>

      {loading && plans.length === 0 ? <p role="status" className="px-5 py-8 text-sm text-light-secondary dark:text-dark-secondary">{labels.loading}</p> : null}
      {!loading && !error && plans.length === 0 ? <p className="px-5 py-8 text-sm text-light-secondary dark:text-dark-secondary">{labels.empty}</p> : null}

      <div className="divide-y divide-light-border dark:divide-dark-border">
        {plans.map((plan) => {
          const busy = busyPlanId === plan.planId
          return (
            <article key={plan.planId} className="space-y-3 p-5" aria-busy={busy}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-base font-bold">{plan.name}</h3>
                  <p className="mt-1 break-all text-xs text-light-secondary dark:text-dark-secondary">{labels.id}: {plan.planId}</p>
                </div>
                <span className="rounded-full bg-light-primary/10 px-3 py-1 text-xs font-bold dark:bg-dark-primary/20">{labels.status[plan.status]}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <p><span className="text-light-secondary dark:text-dark-secondary">{labels.priceLabel}: </span><strong>{formatPrice(plan.priceMinor, plan.currency, locale)}</strong></p>
                <p><span className="text-light-secondary dark:text-dark-secondary">{labels.periodLabel}: </span><strong>{plan.billingInterval === 'MONTHLY' ? labels.monthly : labels.yearly}</strong></p>
                <p><span className="text-light-secondary dark:text-dark-secondary">{labels.trialDaysLabel}: </span><strong>{plan.trialDays}</strong></p>
                <p><span className="text-light-secondary dark:text-dark-secondary">{labels.version}: </span><strong>{plan.planVersion}</strong></p>
              </div>
              <div>
                <p className="text-xs font-semibold text-light-secondary dark:text-dark-secondary">{labels.benefitsLabel}</p>
                {plan.benefits.length ? <ul className="mt-1 list-disc pl-5 text-sm">{plan.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul> : <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">{labels.noBenefits}</p>}
              </div>
              {editingPlanId === plan.planId ? (
                <form onSubmit={(event) => void saveRevision(event, plan)} className="grid grid-cols-1 gap-3 rounded-xl border border-light-border p-4 dark:border-dark-border md:grid-cols-2" aria-busy={savingPlanId === plan.planId}>
                  <h4 className="text-sm font-bold md:col-span-2">{labels.revisionHeading}</h4>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    {labels.name}
                    <input required maxLength={120} value={editName} onChange={(event) => setEditName(event.target.value)} className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    {labels.tier}
                    <input required maxLength={64} pattern="[a-z][a-z0-9_-]{0,63}" value={editTier} onChange={(event) => setEditTier(event.target.value)} className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    {labels.priceLabel} ({plan.currency})
                    <input required inputMode="decimal" value={editPrice} onChange={(event) => setEditPrice(event.target.value)} pattern="(0|[1-9][0-9]*)(\.[0-9]{1,2})?" className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    {labels.trialDays}
                    <input type="number" min={0} max={90} step={1} value={editTrialDays} onChange={(event) => setEditTrialDays(Number(event.target.value))} className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    {labels.interval}
                    <select value={editInterval} onChange={(event) => setEditInterval(event.target.value as 'MONTHLY' | 'YEARLY')} className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border">
                      <option value="MONTHLY">{labels.monthly}</option>
                      <option value="YEARLY">{labels.yearly}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold md:col-span-2">
                    {labels.benefits}
                    <textarea rows={3} value={editBenefitsText} onChange={(event) => setEditBenefitsText(event.target.value)} className="rounded-xl border border-light-border bg-transparent px-3 py-2 font-normal dark:border-dark-border" />
                  </label>
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    <button type="submit" disabled={savingPlanId === plan.planId || busyPlanId !== null} className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                      {savingPlanId === plan.planId ? labels.savingTerms : labels.saveTerms}
                    </button>
                    <button type="button" disabled={savingPlanId !== null} onClick={() => { setEditingPlanId(null); setEditKey('') }} className="rounded-full border border-light-border px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border">
                      {labels.cancelEdit}
                    </button>
                  </div>
                </form>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {plan.status !== 'RETIRED' ? <button type="button" disabled={busy || savingPlanId !== null} onClick={() => beginRevision(plan)} className="rounded-full border border-light-border px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border">{labels.editTerms}</button> : null}
                {plan.status === 'DRAFT' ? <button type="button" disabled={busy} onClick={() => void transition(plan, 'publish')} className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? labels.actionBusy : labels.publish}</button> : null}
                {plan.status === 'ACTIVE' ? <button type="button" disabled={busy} onClick={() => void transition(plan, 'pause')} className="rounded-full border border-light-border px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border">{busy ? labels.actionBusy : labels.pause}</button> : null}
                {plan.status === 'PAUSED' ? <>
                  <button type="button" disabled={busy} onClick={() => void transition(plan, 'resume')} className="rounded-full border border-light-border px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border">{busy ? labels.actionBusy : labels.resume}</button>
                  <button type="button" disabled={busy} onClick={() => void transition(plan, 'retire')} className="rounded-full border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">{busy ? labels.actionBusy : labels.retire}</button>
                </> : null}
              </div>
            </article>
          )
        })}
      </div>
      {hasMore && nextCursor ? <div className="border-t border-light-border p-5 text-center dark:border-dark-border">
        <button type="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); setError(''); void loadPlans(true, nextCursor) }} className="rounded-full border border-light-border px-5 py-2 text-sm font-bold disabled:opacity-50 dark:border-dark-border">
          {loadingMore ? labels.loading : (locale === 'en-US' ? 'Load more plans' : '加载更多方案')}
        </button>
      </div> : null}
    </section>
  )
}
