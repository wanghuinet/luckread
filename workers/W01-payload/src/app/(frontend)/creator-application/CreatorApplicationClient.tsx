'use client'

import Link from 'next/link'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import TwitterCloneSecondaryPageLayout from '../../(twitter-clone)/TwitterCloneSecondaryPageLayout'

type CreatorType = 'PERSONAL' | 'WRITER' | 'VIDEO_CREATOR' | 'DEVELOPER' | 'ARTIST' | 'OTHER'
type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
type GrantState = 'NOT_REQUESTED' | 'PENDING' | 'GRANTED'

type CreatorApplication = {
  application_id: string
  creator_type: CreatorType
  statement: string
  status: ApplicationStatus
  grant_state: GrantState
  version: number
  created_at: string
  updated_at: string
  decided_at: string | null
  decision_reason: string | null
}

type ApiPayload = {
  data?: {
    application?: CreatorApplication | null
    applicationId?: string
    status?: ApplicationStatus
    grantState?: GrantState
    version?: number
    error?: { message?: string; code?: string }
  }
  error?: { message?: string; code?: string }
  requestId?: string
}

const creatorTypes: Array<{ value: CreatorType; label: string; description: string }> = [
  { value: 'PERSONAL', label: '个人创作者', description: '分享个人经验、观点与生活记录' },
  { value: 'WRITER', label: '文章作者', description: '持续创作文章、专栏或深度内容' },
  { value: 'VIDEO_CREATOR', label: '视频创作者', description: '发布原创视频与短视频内容' },
  { value: 'DEVELOPER', label: '开发者', description: '分享软件、技术项目或开发经验' },
  { value: 'ARTIST', label: '艺术与设计', description: '发布视觉、设计、音乐或其他艺术创作' },
  { value: 'OTHER', label: '其他创作方向', description: '其他符合平台规则的原创内容' },
]

function messageFrom(payload: ApiPayload | undefined, fallback: string): string {
  return payload?.data?.error?.message ?? payload?.error?.message ?? getApiErrorMessage(payload, fallback)
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function CreatorApplicationClient({
  layer,
  displayName,
}: {
  layer: string
  displayName: string
}) {
  const [application, setApplication] = useState<CreatorApplication | null>(null)
  const [creatorType, setCreatorType] = useState<CreatorType>('PERSONAL')
  const [statement, setStatement] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null)

  const loadApplication = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<ApiPayload>('/api/v1/creator-applications', {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.status === 401) {
        window.location.assign('/login?returnTo=%2Fcreator-application')
        return
      }
      if (!response.ok) throw new Error(messageFrom(data, '申请状态读取失败，请重试。'))
      const current = data?.data?.application ?? null
      setApplication(current)
      if (current) {
        setCreatorType(current.creator_type)
        setStatement(current.statement ?? '')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '申请状态读取失败，请重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadApplication() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadApplication])

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (layer !== 'L2' || saving) return
    const normalizedStatement = statement.trim()
    const fingerprint = JSON.stringify([creatorType, normalizedStatement])
    if (!requestKey.current || requestKey.current.fingerprint !== fingerprint) {
      requestKey.current = { fingerprint, key: 'creator-apply:' + crypto.randomUUID() }
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { response, data } = await fetchJson<ApiPayload>('/api/v1/creator-applications', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': requestKey.current.key,
        },
        body: JSON.stringify({ creatorType, statement: normalizedStatement }),
      })
      if (response.status === 401) {
        window.location.assign('/login?returnTo=%2Fcreator-application')
        return
      }
      if (!response.ok) throw new Error(messageFrom(data, '提交失败，请检查填写内容后重试。'))
      setNotice('申请已提交，审核状态已更新。')
      await loadApplication()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败，请使用相同内容重试。')
    } finally {
      setSaving(false)
    }
  }

  const canApply = layer === 'L2' && (!application || application.status === 'REJECTED')
  const hasPendingGrant = application?.status === 'APPROVED' && application.grant_state !== 'GRANTED'

  return (
    <TwitterCloneSecondaryPageLayout locale="zh" title="创作者资格" active="editProfile" showLanguageToggle={false}>
      <div className="w-full text-light-primary dark:text-dark-primary">
      <section className="mx-auto mb-6 mt-9 w-full max-w-[840px]">
        <span className="text-[11px] font-extrabold tracking-[0.14em] text-main-accent">CREATOR QUALIFICATION</span>
        <h1>成为 LuckRead 创作者</h1>
        <p>提交创作者资格申请。审核通过并完成权限确认后，即可进入创作者中心发布和管理原创内容。</p>
        <div className="mt-[18px] break-words text-[13px] text-light-secondary dark:text-dark-secondary">申请账号：<strong className="font-semibold text-light-primary dark:text-dark-primary">{displayName}</strong></div>
      </section>

      <section className="mx-auto w-full max-w-[840px] rounded-2xl border border-light-border bg-main-background p-4 sm:p-6 md:p-8 dark:border-dark-border" aria-busy={loading || saving}>
        <div className="flex items-center justify-between gap-3 border-b border-light-border pb-5 dark:border-dark-border">
          <div><span className="text-[11px] font-extrabold tracking-[0.14em] text-main-accent">APPLICATION</span><h2 className="mt-1.5 text-xl font-bold tracking-tight">资格申请与状态</h2></div>
          <button className="min-h-9 shrink-0 rounded-full border border-light-border px-3 text-[13px] text-light-primary hover:bg-main-accent/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-primary" type="button" onClick={() => void loadApplication()} disabled={loading || saving}>
            {loading ? '读取中…' : '刷新状态'}
          </button>
        </div>

        {loading ? <p className="text-sm text-light-secondary dark:text-dark-secondary" role="status">正在读取你的申请状态…</p> : null}
        {error ? <div className="mt-4 flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[#ffd8d6] bg-[#fff5f4] p-3 text-[13px] leading-6 text-[#a42b29] sm:flex-row sm:items-center" role="alert">{error}<button className="shrink-0 rounded-full border border-[#efc2bf] bg-white px-3 py-2 font-semibold text-[#9d2c28] hover:bg-red-50 disabled:opacity-50" type="button" onClick={() => void loadApplication()} disabled={loading}>重试读取</button></div> : null}
        {notice ? <p className="mt-4 text-[13px] text-[#177246]" role="status">{notice}</p> : null}

        {!loading && application ? (
          <article className="mt-5 rounded-2xl border border-light-border bg-main-background p-4 sm:p-5 dark:border-dark-border" aria-label="当前申请状态">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <span className="text-sm font-bold text-light-secondary dark:text-dark-secondary">申请状态</span>
              <span className={application.status === 'APPROVED' && application.grant_state === 'GRANTED' ? 'rounded-full bg-emerald-100 px-3 py-2 text-center text-xs font-bold text-emerald-800' : application.status === 'REJECTED' ? 'rounded-full bg-red-100 px-3 py-2 text-center text-xs font-bold text-red-700' : 'rounded-full bg-amber-100 px-3 py-2 text-center text-xs font-bold text-amber-800'}>
                {application.status === 'PENDING' ? '等待审核' : application.status === 'REJECTED' ? '申请未通过' : application.grant_state === 'GRANTED' ? '已通过 · 权限已生效' : '审核已通过 · 权限确认中'}
              </span>
            </div>
            <dl className="my-5 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              <div><dt className="text-xs text-light-secondary dark:text-dark-secondary">创作方向</dt><dd className="mt-1.5 break-words text-sm text-light-primary dark:text-dark-primary">{creatorTypes.find((item) => item.value === application.creator_type)?.label ?? application.creator_type}</dd></div>
              <div><dt className="text-xs text-light-secondary dark:text-dark-secondary">提交时间</dt><dd className="mt-1.5 break-words text-sm text-light-primary dark:text-dark-primary">{dateLabel(application.created_at)}</dd></div>
              <div><dt className="text-xs text-light-secondary dark:text-dark-secondary">最近更新</dt><dd className="mt-1.5 break-words text-sm text-light-primary dark:text-dark-primary">{dateLabel(application.updated_at)}</dd></div>
              {application.decided_at ? <div><dt className="text-xs text-light-secondary dark:text-dark-secondary">审核时间</dt><dd className="mt-1.5 break-words text-sm text-light-primary dark:text-dark-primary">{dateLabel(application.decided_at)}</dd></div> : null}
            </dl>
            {application.statement ? <div className="border-t border-light-border pt-4 dark:border-dark-border"><strong className="text-[13px] font-bold">申请说明</strong><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-light-secondary dark:text-dark-secondary">{application.statement}</p></div> : null}
            {application.status === 'PENDING' ? <p className="mt-4 rounded-xl bg-main-sidebar-background p-3 text-[13px] leading-7 text-light-secondary dark:text-dark-secondary">申请已收到，请等待审核。你可以随时刷新查看最新状态。</p> : null}
            {application.status === 'REJECTED' ? (
              <div className="border-t border-light-border pt-4 dark:border-dark-border"><strong className="text-[13px] font-bold">审核反馈</strong><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-light-secondary dark:text-dark-secondary">{application.decision_reason || '当前没有附加说明。你可以参考平台规则修改申请内容后重新提交。'}</p></div>
            ) : null}
            {hasPendingGrant ? <p className="mt-4 rounded-xl bg-main-sidebar-background p-3 text-[13px] leading-7 text-light-secondary dark:text-dark-secondary">审核已通过，但 W02 权限授予尚未确认。创作者权限暂未生效，请稍后刷新；若状态持续不变，请联系平台审核员重新确认授权。</p> : null}
            {application.status === 'APPROVED' && application.grant_state === 'GRANTED' ? (
              <Link className="mt-4 inline-flex items-center gap-2 rounded-full bg-main-accent px-4 py-3 text-sm font-bold text-white hover:brightness-90" href="/creator-center">进入创作者中心 <span aria-hidden="true">→</span></Link>
            ) : null}
          </article>
        ) : null}

        {!loading && layer === 'L3' ? (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#cfe8d8] bg-[#f0fbf4] p-4 text-[#17683f]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#dcf6e8] font-extrabold text-[#147448]" aria-hidden="true">✓</span>
            <div className="min-w-0"><h3 className="text-base font-bold">你已具备创作者权限</h3><p className="mb-3 mt-2 text-[13px] leading-7 text-light-secondary">你的账号属于 L3 创作者层级，可以直接进入创作者中心。</p><Link className="text-sm font-bold text-main-accent hover:underline" href="/creator-center">进入创作者中心 →</Link></div>
          </div>
        ) : null}

        {!loading && (layer === 'L7' || layer === 'L8') ? (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#cfe8d8] bg-[#f0fbf4] p-4 text-[#17683f]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#dcf6e8] font-extrabold text-[#147448]" aria-hidden="true">✓</span>
            <div className="min-w-0"><h3 className="text-base font-bold">管理员审核入口</h3><p className="mb-3 mt-2 text-[13px] leading-7 text-light-secondary">你的权限允许审核创作者资格申请。</p><Link className="text-sm font-bold text-main-accent hover:underline" href="/creator-review">打开创作者审核队列 →</Link></div>
          </div>
        ) : null}

        {!loading && layer !== 'L2' && layer !== 'L3' && layer !== 'L7' && layer !== 'L8' ? (
          <div className="mt-5 rounded-xl border border-light-border bg-main-sidebar-background p-4 dark:border-dark-border">
            <h3 className="text-base font-bold">暂不能提交创作者申请</h3>
            <p className="mb-3 mt-2 text-[13px] leading-7 text-light-secondary">请先完成邮箱验证并获得 L2 普通用户权限。账号权限由系统依据验证和授权结果确定，页面不会自行提升权限。</p>
            <Link className="text-sm font-bold text-main-accent hover:underline" href="/me/profile">查看个人资料</Link>
          </div>
        ) : null}

        {!loading && canApply ? (
          <form className="mt-6 grid gap-4" onSubmit={submitApplication}>
            <div className="grid gap-2">
              <h3 className="text-lg font-bold">{application?.status === 'REJECTED' ? '修改申请后重新提交' : '填写创作者申请'}</h3>
              <p className="text-[13px] leading-7 text-light-secondary">请选择与你的原创内容相符的方向，审核结果会显示在本页。</p>
            </div>
            <label className="mt-4 grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary">
              <span className="flex items-center gap-2">创作方向 <b className="text-accent-red" aria-hidden="true">*</b></span>
              <select className="block min-h-11 w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-sm leading-6 text-light-primary outline-none focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-50 dark:border-dark-border dark:text-dark-primary" value={creatorType} onChange={(event) => setCreatorType(event.target.value as CreatorType)} required disabled={saving}>
                {creatorTypes.map((item) => <option key={item.value} value={item.value}>{item.label} — {item.description}</option>)}
              </select>
            </label>
            <label className="mt-4 grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary">
              <span className="flex items-center justify-between gap-2">申请说明 <small className="text-xs font-normal text-light-secondary">选填</small></span>
              <textarea className="block min-h-[124px] w-full resize-y rounded-xl border border-light-border bg-main-background px-3 py-3 text-sm font-normal leading-6 text-light-primary outline-none focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-50 dark:border-dark-border dark:text-dark-primary" value={statement} onChange={(event) => setStatement(event.target.value)} rows={5} maxLength={2000} placeholder="简要介绍你的创作方向、计划发布的内容或相关作品。" disabled={saving} />
              <span className="flex justify-end text-xs font-normal text-light-secondary dark:text-dark-secondary">{statement.length}/2000</span>
            </label>
            <div className="mt-5 flex flex-col items-stretch justify-between gap-4 border-t border-light-border pt-5 sm:flex-row sm:items-center dark:border-dark-border">
              <p className="max-w-[390px] text-xs leading-7 text-light-secondary dark:text-dark-secondary">提交后将进入平台审核。申请不会自动授予 L3 权限。</p>
              <button className="min-h-11 rounded-full border-0 bg-main-accent px-5 font-bold text-white hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={saving}>
                {saving ? '提交中…' : application?.status === 'REJECTED' ? '重新提交申请' : '提交创作者申请'}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <footer className="mx-auto mt-6 flex w-full max-w-[840px] flex-wrap justify-between gap-3 text-[11px] leading-6 text-light-secondary dark:text-dark-secondary">
        <span>LuckRead · 创作者资格服务</span>
        <span>审核通过后，系统还会独立确认创作者角色授权。</span>
      </footer>
      </div>
    </TwitterCloneSecondaryPageLayout>
  )
}
