'use client'

import { ChangeEvent, useState } from 'react'
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
  bodyRef?: string
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
    return saved
  }

  async function saveDraft() {
    setBusy(true); setError(''); setMessage('')
    try {
      if (!title.trim() || !body.trim()) {
        setError('请先填写标题和正文。')
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

  async function submitForReview() {
    setBusy(true); setError(''); setMessage('')
    try {
      if (!title.trim() || !body.trim()) {
        setError('请先填写标题和正文。')
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
          onChange={(event) => setTitle(event.target.value)}
          placeholder={type === 'post' ? '这一刻想分享什么？' : '输入一个清晰、有吸引力的标题'}
          value={title}
        />
      </label>

      <label className="lr-field">
        <span>{type === 'post' ? '正文' : type === 'video' ? '视频简介' : '正文'}</span>
        <textarea
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
                <button onClick={() => removeAsset(asset.id)} type="button">移除</button>
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
          onChange={(event) => setCoverRef(event.target.value)}
          placeholder="默认使用第一个媒体文件"
          value={coverRef}
        />
      </label>

      {message ? <div className="lr-success" role="status">{message}</div> : null}
      {error ? <div className="lr-error" role="alert">{error}</div> : null}

      <div className="lr-actions">
        <button className="secondary" disabled={busy} onClick={saveDraft} type="button">
          {busy ? '处理中…' : '保存草稿'}
        </button>
        <button className="primary" disabled={busy} onClick={submitForReview} type="button">
          {busy ? '处理中…' : '提交发布'}
        </button>
      </div>

      <p className="lr-note">
        提交发布不会绕过审核：创建后先进入草稿，再按内容状态机进入审核和正式发布。
      </p>
    </div>
  )
}
