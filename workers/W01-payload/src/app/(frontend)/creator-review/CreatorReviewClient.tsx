'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import styles from './creator-review.module.css'

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
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>LR</span>
          <span><strong>LuckRead</strong><small>创作者审核</small></span>
        </Link>
        <nav className={styles.links} aria-label="审核导航">
          <span>审核人：{displayName}</span>
          <Link href="/creator-application">资格申请页</Link>
          <Link href="/">首页</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <span className={styles.eyebrow}>CREATOR REVIEW · L7 / L8</span>
        <h1>创作者资格审核</h1>
        <p>审核 API 会再次校验审核人权限。通过申请后，只有 W02 确认 RoleAssignment 写入成功，创作者权限才会生效。</p>
      </section>

      <section className={styles.panel} aria-busy={loading || workingId !== null}>
        <div className={styles.panelHeading}>
          <div><span className={styles.eyebrow}>REVIEW QUEUE</span><h2>待审核与授权待确认</h2></div>
          <button type="button" onClick={() => void loadQueue()} disabled={loading || workingId !== null}>{loading ? '读取中…' : '刷新队列'}</button>
        </div>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {loading ? <p className={styles.muted} role="status">正在读取审核队列…</p> : null}
        {!loading && applications.length === 0 ? (
          <div className={styles.empty}><span aria-hidden="true">✓</span><h3>当前没有待处理申请</h3><p>新申请和授权确认待处理项会显示在这里。</p></div>
        ) : null}
        <div className={styles.queue}>
          {applications.map((application) => {
            const retryingGrant = application.status === 'APPROVED' && application.grant_state === 'PENDING'
            return (
              <article className={styles.card} key={application.application_id}>
                <div className={styles.cardHeading}>
                  <div><span className={styles.eyebrow}>{application.creator_type.replaceAll('_', ' ')}</span><h3>{application.user_id}</h3></div>
                  <span className={retryingGrant ? styles.pendingBadge : styles.statusBadge}>{retryingGrant ? '授权待确认' : '等待审核'}</span>
                </div>
                <p className={styles.statement}>{application.statement || '申请人未填写说明。'}</p>
                <div className={styles.meta}><span>提交于 {dateLabel(application.created_at)}</span><span>版本 v{application.version}</span></div>
                <form onSubmit={(event) => event.preventDefault()} className={styles.decisionForm}>
                  <label>
                    <span>{retryingGrant ? '授权重试说明（选填）' : '审核意见'}</span>
                    <textarea value={reasons[application.application_id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [application.application_id]: event.target.value }))} maxLength={500} rows={3} placeholder={retryingGrant ? '可以补充处理说明。重试会复用原审核幂等键。' : '拒绝时请说明原因；通过时可以填写建议。'} disabled={workingId !== null} />
                  </label>
                  <div className={styles.actions}>
                    {retryingGrant ? (
                      <button className={styles.approve} type="button" disabled={workingId !== null} onClick={() => void decide(application, 'APPROVED')}>{workingId === application.application_id ? '正在重试…' : '重试授权'}</button>
                    ) : (
                      <>
                        <button className={styles.reject} type="button" disabled={workingId !== null} onClick={() => void decide(application, 'REJECTED')}>{workingId === application.application_id ? '处理中…' : '拒绝申请'}</button>
                        <button className={styles.approve} type="button" disabled={workingId !== null} onClick={() => void decide(application, 'APPROVED')}>{workingId === application.application_id ? '处理中…' : '通过并授予 L3'}</button>
                      </>
                    )}
                  </div>
                </form>
              </article>
            )
          })}
        </div>
      </section>
      <footer className={styles.footer}>审核记录与角色授予均由权威服务写入；前端不设定或写入用户层级。</footer>
    </main>
  )
}
