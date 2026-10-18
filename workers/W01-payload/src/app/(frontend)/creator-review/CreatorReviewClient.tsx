'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'

type Decision = 'APPROVED' | 'REJECTED'
type CreatorApplication = {
  application_id: string
  user_id: string
  creator_type: string
  statement: string
  status: 'PENDING' | 'APPROVED'
  grant_state: 'NOT_REQUESTED' | 'PENDING' | 'GRANTED'
  version: number
  created_at: string
}

type ApiPayload = {
  data?: {
    data?: CreatorApplication[]
    applicationId?: string
    status?: string
    grantState?: string
    version?: number
    error?: { message?: string; code?: string }
  }
  error?: { message?: string; code?: string }
}

function messageFrom(payload: ApiPayload | undefined, fallback: string): string {
  return payload?.data?.error?.message ?? payload?.error?.message ?? getApiErrorMessage(payload, fallback)
}

function dateLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function CreatorReviewClient({ displayName }: { displayName: string }) {
  const [applications, setApplications] = useState<CreatorApplication[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<ApiPayload>('/api/v1/admin/creator-applications?limit=50', {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.status === 401) {
        window.location.assign('/login?returnTo=%2Fcreator-review')
        return
      }
      if (!response.ok) throw new Error(messageFrom(data, '审核队列读取失败，请重试。'))
      setApplications(data?.data?.data ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '审核队列读取失败，请重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQueue() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadQueue])

  async function decide(application: CreatorApplication, decision: Decision) {
    if (workingId) return
    const reason = (reasons[application.application_id] ?? '').trim()
    if (decision === 'REJECTED' && !reason) {
      setError('拒绝申请前，请填写具体审核原因，便于申请人修改后重新提交。')
      return
    }
    const retryingGrant = application.status === 'APPROVED' && application.grant_state === 'PENDING'
    const originalVersion = retryingGrant ? application.version - 1 : application.version
    const key = 'creator-review:' + application.application_id + ':' + originalVersion + ':' + decision
    setWorkingId(application.application_id)
    setError('')
    setNotice('')
    try {
      const { response, data } = await fetchJson<ApiPayload>('/api/v1/admin/creator-applications', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'If-Match': '"' + application.version + '"',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ applicationId: application.application_id, decision, reason }),
      })
      if (response.status === 401) {
        window.location.assign('/login?returnTo=%2Fcreator-review')
        return
      }
      if (!response.ok) throw new Error(messageFrom(data, '审核操作失败。若是授权暂挂，请保留原申请并使用相同操作重试。'))
      if (data?.data?.status === 'APPROVED' && data.data.grantState === 'PENDING') {
        setNotice('审核已保存，但 L3 权限尚未确认。请在下方点击“重试授权”，不要重复创建申请。')
      } else {
        setNotice(decision === 'APPROVED' ? '申请已通过，系统已确认创作者权限授予。' : '申请已拒绝，审核原因已记录。')
      }
      await loadQueue()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '审核操作失败，请刷新队列后重试。')
      await loadQueue()
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <main className="min-h-screen bg-main-background px-4 pb-8 text-light-primary dark:text-dark-primary">
      <header className="mx-auto flex min-h-[76px] w-full max-w-[1000px] flex-wrap items-center justify-between gap-4 border-b border-light-border py-3 dark:border-dark-border">
        <Link className="flex items-center gap-2.5 text-inherit no-underline" href="/">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-main-accent font-extrabold text-white">LR</span>
          <span><strong className="block font-bold">LuckRead</strong><small className="mt-0.5 block text-xs text-light-secondary dark:text-dark-secondary">创作者审核</small></span>
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-xs text-light-secondary dark:text-dark-secondary" aria-label="审核导航">
          <span>审核人：{displayName}</span>
          <Link className="text-main-accent hover:underline" href="/creator-application">资格申请页</Link>
          <Link className="text-main-accent hover:underline" href="/">首页</Link>
        </nav>
      </header>

      <section className="mx-auto mb-5 mt-9 w-full max-w-[840px]">
        <span className="text-[11px] font-extrabold tracking-[0.13em] text-main-accent">CREATOR REVIEW · L7 / L8</span>
        <h1 className="my-2 text-3xl font-bold tracking-tight">创作者资格审核</h1>
        <p className="max-w-[700px] text-sm leading-7 text-light-secondary dark:text-dark-secondary">审核 API 会再次校验审核人权限。通过申请后，只有 W02 确认 RoleAssignment 写入成功，创作者权限才会生效。</p>
      </section>

      <section className="mx-auto w-full max-w-[840px] rounded-2xl border border-light-border bg-main-background p-4 shadow-sm sm:p-6 dark:border-dark-border" aria-busy={loading || workingId !== null}>
        <div className="flex items-center justify-between gap-4 border-b border-light-border pb-4 dark:border-dark-border">
          <div><span className="text-[11px] font-extrabold tracking-[0.13em] text-main-accent">REVIEW QUEUE</span><h2 className="mt-1.5 text-xl font-bold">待审核与授权待确认</h2></div>
          <button className="min-h-9 rounded-full border border-light-border px-3 text-[13px] font-semibold text-light-primary hover:bg-main-accent/10 disabled:opacity-50 dark:border-dark-border dark:text-dark-primary" type="button" onClick={() => void loadQueue()} disabled={loading || workingId !== null}>{loading ? '读取中…' : '刷新队列'}</button>
        </div>
        {error ? <div className="mt-4 rounded-xl border border-[#ffd5d2] bg-[#fff4f3] p-3 text-[13px] leading-7 text-[#a22e29]" role="alert">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-xl border border-[#cfe8d8] bg-[#f0fbf4] p-3 text-[13px] leading-7 text-[#17683f]" role="status">{notice}</div> : null}
        {loading ? <p className="text-sm text-light-secondary dark:text-dark-secondary" role="status">正在读取审核队列…</p> : null}
        {!loading && applications.length === 0 ? (
          <div className="px-3 py-11 text-center"><span className="inline-grid h-[38px] w-[38px] place-items-center rounded-full bg-emerald-100 font-extrabold text-emerald-700" aria-hidden="true">✓</span><h3 className="my-3 text-lg font-bold">当前没有待处理申请</h3><p className="m-0 text-[13px] text-light-secondary dark:text-dark-secondary">新申请和授权确认待处理项会显示在这里。</p></div>
        ) : null}
        <div className="mt-5 grid gap-4">
          {applications.map((application) => {
            const retryingGrant = application.status === 'APPROVED' && application.grant_state === 'PENDING'
            return (
              <article className="rounded-2xl border border-light-border bg-main-sidebar-background p-4 sm:p-5 dark:border-dark-border" key={application.application_id}>
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
                  <div><span className="text-[11px] font-extrabold tracking-[0.13em] text-main-accent">{application.creator_type.replaceAll('_', ' ')}</span><h3 className="mt-2 break-all text-[15px] font-bold">{application.user_id}</h3></div>
                  <span className={retryingGrant ? 'whitespace-nowrap rounded-full bg-[#eaf1ff] px-3 py-1.5 text-[11px] font-bold text-[#2b58bf]' : 'whitespace-nowrap rounded-full bg-[#fff4dc] px-3 py-1.5 text-[11px] font-bold text-[#8b5a05]'}>{retryingGrant ? '授权待确认' : '等待审核'}</span>
                </div>
                <p className="my-4 whitespace-pre-wrap break-words text-sm leading-7 text-light-secondary dark:text-dark-secondary">{application.statement || '申请人未填写说明。'}</p>
                <div className="flex flex-wrap justify-between gap-2 text-[11px] text-light-secondary dark:text-dark-secondary"><span>提交于 {dateLabel(application.created_at)}</span><span>版本 v{application.version}</span></div>
                <form onSubmit={(event) => event.preventDefault()} className="mt-4 border-t border-light-border pt-4 dark:border-dark-border">
                  <label className="grid gap-2 text-[13px] font-semibold text-light-primary dark:text-dark-primary">
                    <span>{retryingGrant ? '授权重试说明（选填）' : '审核意见'}</span>
                    <textarea className="w-full resize-y rounded-xl border border-light-border bg-main-background px-3 py-3 text-sm font-normal leading-6 text-light-primary outline-none focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-50 dark:border-dark-border dark:text-dark-primary" value={reasons[application.application_id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [application.application_id]: event.target.value }))} maxLength={500} rows={3} placeholder={retryingGrant ? '可以补充处理说明。重试会复用原审核幂等键。' : '拒绝时请说明原因；通过时可以填写建议。'} disabled={workingId !== null} />
                  </label>
                  <div className="mt-3 flex justify-end gap-3">
                    {retryingGrant ? (
                      <button className="min-h-10 rounded-full border border-main-accent bg-main-accent px-4 text-[13px] font-bold text-white hover:brightness-90 disabled:cursor-wait disabled:opacity-50" type="button" disabled={workingId !== null} onClick={() => void decide(application, 'APPROVED')}>{workingId === application.application_id ? '正在重试…' : '重试授权'}</button>
                    ) : (
                      <>
                        <button className="min-h-10 rounded-full border border-light-border bg-main-background px-4 text-[13px] font-bold text-accent-red hover:bg-accent-red/10 disabled:cursor-wait disabled:opacity-50 dark:border-dark-border" type="button" disabled={workingId !== null} onClick={() => void decide(application, 'REJECTED')}>{workingId === application.application_id ? '处理中…' : '拒绝申请'}</button>
                        <button className="min-h-10 rounded-full border border-main-accent bg-main-accent px-4 text-[13px] font-bold text-white hover:brightness-90 disabled:cursor-wait disabled:opacity-50" type="button" disabled={workingId !== null} onClick={() => void decide(application, 'APPROVED')}>{workingId === application.application_id ? '处理中…' : '通过并授予 L3'}</button>
                      </>
                    )}
                  </div>
                </form>
              </article>
            )
          })}
        </div>
      </section>
      <footer className="mx-auto mt-5 w-full max-w-[840px] text-[11px] leading-7 text-light-secondary dark:text-dark-secondary">审核记录与角色授予均由权威服务写入；前端不设定或写入用户层级。</footer>
    </main>
  )
}
