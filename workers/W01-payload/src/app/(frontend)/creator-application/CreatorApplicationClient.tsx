'use client'

import Link from 'next/link'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import styles from './creator-application.module.css'

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
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="LuckRead 首页">
          <span className={styles.brandMark}>LR</span>
          <span><strong>LuckRead</strong><small>创作者资格</small></span>
        </Link>
        <nav className={styles.headerLinks} aria-label="账户导航">
          <Link href="/me/profile">个人资料</Link>
          <Link href="/">返回首页</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <span className={styles.eyebrow}>CREATOR QUALIFICATION</span>
        <h1>成为 LuckRead 创作者</h1>
        <p>提交创作者资格申请。审核通过并完成权限确认后，即可进入创作者中心发布和管理原创内容。</p>
        <div className={styles.applicant}>申请账号：<strong>{displayName}</strong></div>
      </section>

      <section className={styles.panel} aria-busy={loading || saving}>
        <div className={styles.panelHeading}>
          <div><span className={styles.eyebrow}>APPLICATION</span><h2>资格申请与状态</h2></div>
          <button className={styles.refreshButton} type="button" onClick={() => void loadApplication()} disabled={loading || saving}>
            {loading ? '读取中…' : '刷新状态'}
          </button>
        </div>

        {loading ? <p className={styles.loading} role="status">正在读取你的申请状态…</p> : null}
        {error ? <div className={styles.error} role="alert">{error}<button type="button" onClick={() => void loadApplication()} disabled={loading}>重试读取</button></div> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

        {!loading && application ? (
          <article className={styles.statusCard} aria-label="当前申请状态">
            <div className={styles.statusHeading}>
              <span className={styles.statusLabel}>申请状态</span>
              <span className={application.status === 'APPROVED' && application.grant_state === 'GRANTED' ? styles.statusSuccess : application.status === 'REJECTED' ? styles.statusRejected : styles.statusPending}>
                {application.status === 'PENDING' ? '等待审核' : application.status === 'REJECTED' ? '申请未通过' : application.grant_state === 'GRANTED' ? '已通过 · 权限已生效' : '审核已通过 · 权限确认中'}
              </span>
            </div>
            <dl className={styles.details}>
              <div><dt>创作方向</dt><dd>{creatorTypes.find((item) => item.value === application.creator_type)?.label ?? application.creator_type}</dd></div>
              <div><dt>提交时间</dt><dd>{dateLabel(application.created_at)}</dd></div>
              <div><dt>最近更新</dt><dd>{dateLabel(application.updated_at)}</dd></div>
              {application.decided_at ? <div><dt>审核时间</dt><dd>{dateLabel(application.decided_at)}</dd></div> : null}
            </dl>
            {application.statement ? <div className={styles.statement}><strong>申请说明</strong><p>{application.statement}</p></div> : null}
            {application.status === 'PENDING' ? <p className={styles.statusMessage}>申请已收到，请等待审核。你可以随时刷新查看最新状态。</p> : null}
            {application.status === 'REJECTED' ? (
              <div className={styles.rejection}><strong>审核反馈</strong><p>{application.decision_reason || '当前没有附加说明。你可以参考平台规则修改申请内容后重新提交。'}</p></div>
            ) : null}
            {hasPendingGrant ? <p className={styles.statusMessage}>审核已通过，但 W02 权限授予尚未确认。创作者权限暂未生效，请稍后刷新；若状态持续不变，请联系平台审核员重新确认授权。</p> : null}
            {application.status === 'APPROVED' && application.grant_state === 'GRANTED' ? (
              <Link className={styles.primaryLink} href="/creator-center">进入创作者中心 <span aria-hidden="true">→</span></Link>
            ) : null}
          </article>
        ) : null}

        {!loading && layer === 'L3' ? (
          <div className={styles.eligibleNotice}>
            <span className={styles.checkIcon} aria-hidden="true">✓</span>
            <div><h3>你已具备创作者权限</h3><p>你的账号属于 L3 创作者层级，可以直接进入创作者中心。</p><Link href="/creator-center">进入创作者中心 →</Link></div>
          </div>
        ) : null}

        {!loading && (layer === 'L7' || layer === 'L8') ? (
          <div className={styles.eligibleNotice}>
            <span className={styles.checkIcon} aria-hidden="true">✓</span>
            <div><h3>管理员审核入口</h3><p>你的权限允许审核创作者资格申请。</p><Link href="/creator-review">打开创作者审核队列 →</Link></div>
          </div>
        ) : null}

        {!loading && layer !== 'L2' && layer !== 'L3' && layer !== 'L7' && layer !== 'L8' ? (
          <div className={styles.lockedNotice}>
            <h3>暂不能提交创作者申请</h3>
            <p>请先完成邮箱验证并获得 L2 普通用户权限。账号权限由系统依据验证和授权结果确定，页面不会自行提升权限。</p>
            <Link href="/me/profile">查看个人资料</Link>
          </div>
        ) : null}

        {!loading && canApply ? (
          <form className={styles.form} onSubmit={submitApplication}>
            <div className={styles.formIntro}>
              <h3>{application?.status === 'REJECTED' ? '修改申请后重新提交' : '填写创作者申请'}</h3>
              <p>请选择与你的原创内容相符的方向，审核结果会显示在本页。</p>
            </div>
            <label className={styles.field}>
              <span>创作方向 <b aria-hidden="true">*</b></span>
              <select value={creatorType} onChange={(event) => setCreatorType(event.target.value as CreatorType)} required disabled={saving}>
                {creatorTypes.map((item) => <option key={item.value} value={item.value}>{item.label} — {item.description}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>申请说明 <small>选填</small></span>
              <textarea value={statement} onChange={(event) => setStatement(event.target.value)} rows={5} maxLength={2000} placeholder="简要介绍你的创作方向、计划发布的内容或相关作品。" disabled={saving} />
              <span className={styles.counter}>{statement.length}/2000</span>
            </label>
            <div className={styles.formFoot}>
              <p>提交后将进入平台审核。申请不会自动授予 L3 权限。</p>
              <button className={styles.primaryButton} type="submit" disabled={saving}>
                {saving ? '提交中…' : application?.status === 'REJECTED' ? '重新提交申请' : '提交创作者申请'}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <footer className={styles.footer}>
        <span>LuckRead · 创作者资格服务</span>
        <span>审核通过后，系统还会独立确认创作者角色授权。</span>
      </footer>
    </main>
  )
}
