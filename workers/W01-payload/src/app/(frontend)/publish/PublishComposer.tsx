'use client'

import { ChangeEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type ContentType = 'article' | 'post' | 'video'

type UploadedAsset = {
  id: string
  url: string
  filename?: string
  mimeType: string
}

type ContentResponse = {
  id: string
  state: string
  version: number
  etag: string
  contentType?: ContentType
  title?: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
}

const ACCESS_KEY = 'luckread.accessToken'
const REFRESH_KEY = 'luckread.refreshToken'
const DEVICE_KEY = 'luckread.deviceId'

function getDeviceId() {
  const existing = sessionStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const value = crypto.randomUUID()
  sessionStorage.setItem(DEVICE_KEY, value)
  return value
}

async function refreshAccessToken() {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY)
  if (!refreshToken) return null
  const response = await fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken, deviceId: getDeviceId() }),
  })
  const data = await response.json().catch((): null => null)
  if (!response.ok || !data?.accessToken) return null
  sessionStorage.setItem(ACCESS_KEY, data.accessToken)
  if (data.refreshToken) sessionStorage.setItem(REFRESH_KEY, data.refreshToken)
  return data.accessToken as string
}

async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  let token = sessionStorage.getItem(ACCESS_KEY)
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', 'Bearer ' + token)

  let response = await fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (response.status === 401 && token) {
    token = await refreshAccessToken()
    if (!token) throw new Error('AUTH_REQUIRED')
    headers.set('Authorization', 'Bearer ' + token)
    response = await fetch(input, {
      ...init,
      headers,
      credentials: 'include',
    })
  }

  if (response.status === 401) throw new Error('AUTH_REQUIRED')
  return response
}

type PublishComposerProps = {
  contentBasePath?: string
}

export default function PublishComposer({
  contentBasePath = '/api/v1/contents',
}: PublishComposerProps) {
  const router = useRouter()
  const [type, setType] = useState<ContentType>('article')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assets, setAssets] = useState<UploadedAsset[]>([])
  const [coverRef, setCoverRef] = useState('')
  const [draft, setDraft] = useState<ContentResponse | null>(null)
  const [savedBody, setSavedBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    let cancelled = false
    const draftId = new URL(window.location.href).searchParams.get('draft')?.trim()
    if (!draftId) return

    async function restoreDraft() {
      setBusy(true)
      setError('')
      setMessage('正在恢复草稿…')
      try {
        const response = await authorizedFetch(
          `${contentBasePath}/${encodeURIComponent(draftId)}`,
          { method: 'GET' },
        )
        const data = await response.json().catch((): null => null)
        if (!response.ok || !data?.id || !data?.etag) throw new Error(data?.error?.message || 'DRAFT_RECOVERY_FAILED')
        const recovered = data as ContentResponse
        let recoveredBody = ''
        if (recovered.bodyRef) {
          const bodyResponse = await fetch(recovered.bodyRef, { method: 'GET', credentials: 'same-origin' })
          if (bodyResponse.ok) recoveredBody = await bodyResponse.text()
        }
        if (cancelled) return
        setDraft(recovered)
        setType(recovered.contentType ?? 'article')
        setTitle(recovered.title ?? '')
        setBody(recoveredBody)
        setSavedBody(recoveredBody)
        setCoverRef(recovered.coverRef ?? '')
        setAssets((recovered.mediaRefs ?? []).map((url: string) => ({
          id: url,
          url,
          filename: '已关联媒体',
          mimeType: 'application/octet-stream',
        })))
        setMessage(recovered.state === 'PENDING_REVIEW' ? '草稿已恢复，当前正在审核。' : '草稿已恢复。')
      } catch (caught) {
        if (cancelled) return
        const code = caught instanceof Error ? caught.message : ''
        setError(code === 'AUTH_REQUIRED' ? '登录已失效，请重新登录。' : '草稿恢复失败，请检查链接或稍后重试。')
        setMessage('')
        if (code === 'AUTH_REQUIRED') router.replace(window.location.pathname.startsWith('/admin/') ? '/admin/login' : '/login')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void restoreDraft()
    return () => { cancelled = true }
  }, [contentBasePath, router])

  async function uploadFile(file: File): Promise<UploadedAsset> {
    const form = new FormData()
    form.append('alt', file.name)
    form.append('file', file)
    const response = await authorizedFetch('/api/media', { method: 'POST', body: form })
    const data = await response.json().catch((): null => null)
    const doc = data?.doc ?? data
    if (!response.ok || !doc?.id || !doc?.url) {
      throw new Error('MEDIA_UPLOAD_FAILED')
    }
    return {
      id: String(doc.id),
      url: String(doc.url),
      filename: typeof doc.filename === 'string' ? doc.filename : file.name,
      mimeType: file.type || 'application/octet-stream',
    }
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    if (!selected.length) return
    setError('')
    setMessage('正在上传媒体…')
    try {
      const uploaded: UploadedAsset[] = []
      for (const file of selected.slice(0, 12)) uploaded.push(await uploadFile(file))
      setAssets((current) => [...current, ...uploaded])
      setMessage(`已上传 ${uploaded.length} 个媒体文件`)
    } catch {
      setError('媒体上传失败，请检查文件后重试。')
      setMessage('')
    } finally {
      event.target.value = ''
    }
  }

  function removeAsset(id: string) {
    setAssets((current) => current.filter((asset) => asset.id !== id))
  }

  const reviewLocked = draft?.state === 'PENDING_REVIEW'

  const stateLabel = draft?.state === 'DRAFT'
    ? '草稿已保存'
    : draft?.state === 'PENDING_REVIEW'
      ? '审核中'
      : draft?.state === 'REJECTED'
        ? '审核退回'
        : draft?.state === 'PUBLISHED'
          ? '已发布'
          : draft?.state

  async function persistDraft(): Promise<ContentResponse> {
    let bodyRef = draft?.bodyRef
    if (!bodyRef || savedBody !== body) {
      const bodyFile = new File(
        [body],
        `luckread-content-${crypto.randomUUID()}.txt`,
        { type: 'text/plain;charset=utf-8' },
      )
      bodyRef = (await uploadFile(bodyFile)).url
    }

    const payload = {
      contentType: type,
      title: title.trim(),
      bodyRef,
      mediaRefs: assets.map((asset) => asset.url),
      coverRef: coverRef.trim() || assets[0]?.url || null,
    }

    const isUpdate = Boolean(draft?.id && draft.etag)
    const response = await authorizedFetch(
      isUpdate
        ? `${contentBasePath}/${encodeURIComponent(draft!.id)}`
        : contentBasePath,
      {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(isUpdate ? { 'If-Match': draft!.etag } : {}),
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      },
    )
    const data = await response.json().catch((): null => null)
    if (!response.ok) throw new Error(data?.error?.message || 'CONTENT_SAVE_FAILED')
    const saved = data as ContentResponse
    setDraft(saved)
    setSavedBody(body)
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('draft', saved.id)
    window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
    return saved
  }

  async function copyDraftLink() {
    if (!draft?.id) return
    const url = new URL(window.location.href)
    url.searchParams.set('draft', draft.id)
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setMessage('草稿恢复链接已复制。登录后可在其他设备继续编辑。')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('无法复制链接，请从地址栏复制当前页面地址。')
    }
  }

  async function saveDraft() {
    setBusy(true); setError(''); setMessage('')
    try {
      if (!title.trim() || !body.trim()) {
        setError('请先填写标题和正文。')
        return
      }
      if (type === 'video' && assets.length === 0) {
        setError('视频至少需要添加一个媒体文件。')
        return
      }
      await persistDraft()
      setMessage('草稿已保存。')
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code === 'AUTH_REQUIRED' ? '登录已失效，请重新登录。' : '草稿保存失败，请稍后重试。')
      if (code === 'AUTH_REQUIRED') {
        if (window.location.pathname.startsWith('/admin/')) {
          router.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`)
        } else {
          router.replace('/login')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  async function discardDraft() {
    if (!draft?.id || draft.state !== 'DRAFT') return
    if (!window.confirm('确定放弃这份草稿吗？此操作不可撤销。')) return

    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await authorizedFetch(
        contentBasePath + '/' + encodeURIComponent(draft.id),
        {
          method: 'DELETE',
          headers: {
            'If-Match': draft.etag,
            'Idempotency-Key': crypto.randomUUID(),
          },
        },
      )
      if (!response.ok) {
        const data = await response.json().catch((): null => null)
        throw new Error(data?.error?.message || 'CONTENT_DELETE_FAILED')
      }
      setDraft(null)
      setSavedBody('')
      setTitle('')
      setBody('')
      setAssets([])
      setCoverRef('')
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.delete('draft')
      window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
      setMessage('草稿已放弃。')
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code === 'AUTH_REQUIRED' ? '登录已失效，请重新登录。' : '放弃草稿失败，请稍后重试。')
      if (code === 'AUTH_REQUIRED') {
        router.replace(window.location.pathname.startsWith('/admin/') ? '/admin/login' : '/login')
      }
    } finally {
      setBusy(false)
    }
  }

  async function submitForReview() {
    setBusy(true); setError(''); setMessage('')
    try {
      if (!title.trim() || !body.trim()) {
        setError('请先填写标题和正文。')
        return
      }
      if (type === 'video' && assets.length === 0) {
        setError('视频至少需要添加一个媒体文件。')
        return
      }
      const savedDraft = await persistDraft()
      const response = await authorizedFetch(`${contentBasePath}/${encodeURIComponent(savedDraft.id)}/state`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'If-Match': savedDraft.etag,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ to: 'PENDING_REVIEW' }),
      })
      const data = await response.json().catch((): null => null)
      if (!response.ok) throw new Error(data?.error?.message || 'SUBMIT_FAILED')
      const transition = data as { to?: string; version?: number; etag?: string }
      setDraft((current) =>
        current && transition.to && typeof transition.version === 'number' && transition.etag
          ? { ...current, state: transition.to, version: transition.version, etag: transition.etag }
          : current,
      )
      setMessage('已提交发布审核。审核通过后将进入正式发布状态。')
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code === 'AUTH_REQUIRED' ? '登录已失效，请重新登录。' : '提交失败，请稍后重试。')
      if (code === 'AUTH_REQUIRED') {
        router.replace(window.location.pathname.startsWith('/admin/') ? '/admin/login' : '/login')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lr-composer-card">
      <div className="lr-type-tabs" role="tablist" aria-label="内容类型">
        {([
          ['article', '文章'],
          ['post', '动态'],
          ['video', '视频'],
        ] as const).map(([value, label]) => (
          <button
            aria-selected={type === value}
            className={type === value ? 'active' : ''}
            key={value}
            disabled={busy || reviewLocked}
            onClick={() => setType(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <label className="lr-field">
        <span>标题</span>
        <input
          maxLength={512}
          disabled={busy || reviewLocked}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={type === 'post' ? '这一刻想分享什么？' : '输入一个清晰、有吸引力的标题'}
          value={title}
        />
      </label>

      <label className="lr-field">
        <span>{type === 'post' ? '正文' : type === 'video' ? '视频简介' : '正文'}</span>
        <textarea
          disabled={busy || reviewLocked}
          onChange={(event) => setBody(event.target.value)}
          placeholder="写下你的内容…"
          rows={14}
          value={body}
        />
      </label>

      <div className="lr-media-box">
        <div className="lr-media-heading">
          <div>
            <strong>图片 / 视频</strong>
            <span>{assets.length}/12</span>
          </div>
          <label className="lr-upload-button">
            添加媒体
            <input
              accept="image/*,video/*"
              hidden
              multiple
              disabled={busy || reviewLocked}
            onChange={handleFiles}
              type="file"
            />
          </label>
        </div>
        {assets.length ? (
          <div className="lr-asset-list">
            {assets.map((asset) => (
              <div className="lr-asset" key={asset.id}>
                <div>
                  <strong>{asset.filename ?? asset.id}</strong>
                  <span>{asset.mimeType}</span>
                </div>
                <button disabled={busy || reviewLocked} onClick={() => removeAsset(asset.id)} type="button">移除</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="lr-empty">可一次选择多张图片或一个视频，也可以只发纯文字。</p>
        )}
      </div>

      <label className="lr-field">
        <span>封面引用（可选）</span>
        <input
          disabled={busy || reviewLocked}
          onChange={(event) => setCoverRef(event.target.value)}
          placeholder="默认使用第一个媒体文件"
          value={coverRef}
        />
      </label>

      {draft ? (
        <div className="lr-content-status" role="status">
          <span>当前状态</span>
          <strong>{stateLabel}</strong>
          <span>版本 {draft.version}</span>
        </div>
      ) : null}
      {message ? <div className="lr-success" role="status">{message}</div> : null}
      {error ? <div className="lr-error" role="alert">{error}</div> : null}

      {preview ? (
        <section className="lr-preview" aria-label="发布预览">
          <div className="lr-preview-heading">
            <strong>发布预览</strong>
            <button className="ghost" onClick={() => setPreview(false)} type="button">返回编辑</button>
          </div>
          <article className="lr-preview-card">
            <span className="lr-preview-type">{type === 'article' ? '文章' : type === 'post' ? '动态' : '视频'}</span>
            <h2>{title.trim() || '未填写标题'}</h2>
            <p className="lr-preview-body">{body.trim() || '暂无正文'}</p>
            {assets.length ? <div className="lr-preview-media">已添加 {assets.length} 个媒体文件</div> : null}
          </article>
        </section>
      ) : null}

      <div className="lr-actions">
        <button className="ghost" disabled={busy} onClick={() => setPreview((current) => !current)} type="button">
          {preview ? '关闭预览' : '预览'}
        </button>
        {draft?.id && draft.state === 'DRAFT' ? (
          <button className="ghost" disabled={busy} onClick={copyDraftLink} type="button">
            {copied ? '已复制' : '复制恢复链接'}
          </button>
        ) : null}
        {draft?.state === 'DRAFT' ? (
          <button className="danger" disabled={busy} onClick={discardDraft} type="button">
            放弃草稿
          </button>
        ) : null}
        <button className="secondary" disabled={busy} onClick={saveDraft} type="button">
          {busy ? '处理中…' : '保存草稿'}
        </button>
        <button className="primary" disabled={busy || draft?.state === 'PENDING_REVIEW'} onClick={submitForReview} type="button">
          {busy ? '处理中…' : draft?.state === 'PENDING_REVIEW' ? '审核中…' : '提交发布'}
        </button>
      </div>

      <p className="lr-note">
        提交发布不会绕过审核：创建后先进入草稿，再按内容状态机进入审核和正式发布。
      </p>
    </div>
  )
}
